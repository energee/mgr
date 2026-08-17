/**
 * AI Chat Tools
 *
 * Defines the tools available to the AI chat assistant. Tools fall into
 * four categories:
 *
 * 1. **Generic entity tools** — `searchEntity` and `getEntityDetail` use the
 *    entity registry + service layer to handle any entity type, replacing
 *    ~16 hand-crafted search/detail tools.
 * 2. **Specialized query tools** — Domain-specific queries that require
 *    custom SQL joins, aggregations, or views not covered by generic search.
 *    The single-table filtered searches among these are config-driven: their
 *    configs live in `./search-tools.ts` and are instantiated here by
 *    `createSearchTools`.
 * 3. **RPC tools** — Wrappers around Supabase RPC calls to PostgreSQL functions.
 * 4. **Confirm-gated write tools** — Return ConfirmWriteIntent objects
 *    (`action: "confirm_write"`). Nothing is written here: the client renders
 *    a Confirm/Cancel card and, on confirm, POSTs the payload to
 *    `/api/chat/write`, which re-validates and executes under the caller's
 *    session client (RLS-enforced). See `src/lib/schemas/chat-write.ts`.
 */

import { tool } from "ai";
import { z } from "zod";
import { projectedReadyDate } from "@/domain/batch-schedule";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { formatStateLabel } from "@/types/entity";
import { getHelpContentForSystemPrompt } from "@/lib/help-content";
import { batchTransitions } from "@/lib/schemas/batch";
import {
  READING_TYPES,
  validateReading,
  formatReadingValue,
  type ReadingType,
} from "@/domain/batch-readings";
import {
  READING_ELIGIBLE_STATES,
  type ConfirmWriteIntent,
} from "@/lib/schemas/chat-write";
import { entityService } from "@/services/entity-service";
import { inventoryService } from "@/services/inventory-service";
import { dynamicFrom, dynamicRpc, formatServiceError } from "@/services/types";
import { coreRegistry } from "@/entities/cores";
import { escapeIlikePattern } from "@/lib/supabase/query-helpers";
import { createSearchTools } from "./search-tools";

/** Execute an RPC call and throw on error. */
async function rpc<T>(
  supabase: SupabaseClient<Database>,
  fn: string,
  params: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await dynamicRpc(supabase, fn, params);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Execute a Supabase query and throw on error. Reduces boilerplate in tools. */
async function query<T>(
  builder: PromiseLike<{ data: T | null; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await builder;
  if (error) throw new Error(error.message);
  return data as T;
}

/** Resolve a batch by UUID or batch number. Returns `{ id, batch_code, status }`. */
async function resolveBatch(
  supabase: SupabaseClient,
  batchId?: string,
  batchNumber?: string,
): Promise<{ id: string; batch_code: string; status: string }> {
  if (batchId) {
    const { data, error } = await supabase
      .from("batches")
      .select("id, batch_code, status")
      .eq("id", batchId)
      .single();
    if (error) throw new Error(`Batch not found: ${error.message}`);
    return data;
  }
  if (batchNumber) {
    const { data, error } = await supabase
      .from("batches")
      .select("id, batch_code, status")
      .ilike("batch_code", `%${escapeIlikePattern(batchNumber)}%`)
      .limit(1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0)
      throw new Error(`No batch found matching "${batchNumber}"`);
    return data[0];
  }
  throw new Error("Either batchId or batchNumber is required");
}

/**
 * Single-column name/number lookups performed by `lookupEntity`. Each is a
 * case-insensitive partial match on one column, capped at five rows, with the
 * matched column doubling as the human-readable display value.
 */
const LOOKUP_TARGETS: ReadonlyArray<{
  type: string;
  table: string;
  column: string;
  /** Restrict to active rows — only customers can be deactivated. */
  activeOnly?: boolean;
}> = [
  { type: "recipe", table: "recipes", column: "name" },
  { type: "customer", table: "customers", column: "name", activeOnly: true },
  { type: "brand", table: "brands", column: "name" },
  { type: "order", table: "orders", column: "order_number" },
];

/**
 * Sorted, comma-separated list of registry entity names. Built once at module
 * load — `coreRegistry` is a top-level `const` so it's fully populated by the
 * time this expression evaluates.
 */
const ENTITY_NAMES_LIST = Array.from(coreRegistry.keys()).sort().join(", ");

/**
 * Create chat tools bound to an authenticated Supabase client.
 * Read tools query data directly. Write tools persist nothing: they return a
 * ConfirmWriteIntent the client renders as a Confirm/Cancel card, and only an
 * explicit confirmation POSTs it to /api/chat/write.
 */
export function createChatTools(supabase: SupabaseClient<Database>) {
  return {
    // =========================================================================
    // Generic Entity Tools (config-driven via entity registry + service layer)
    // =========================================================================

    searchEntity: tool({
      // Entity list is derived from coreRegistry so the description can never
      // drift from the entities the tool actually supports.
      description:
        `Search any entity type. Available entities: ${ENTITY_NAMES_LIST}. Use 'query' for text search across searchable fields. Use 'filters' for exact-match filtering (e.g. status, category).`,
      inputSchema: z.object({
        entityName: z
          .string()
          .describe("Entity name (snake_case). See description for available names."),
        query: z
          .string()
          .optional()
          .describe("Free-text search across entity's searchable fields"),
        filters: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            "Exact-match filters as key-value pairs (e.g. {status: 'active'})"
          ),
        limit: z
          .number()
          .optional()
          .default(20)
          .describe("Max results to return"),
      }),
      execute: async ({ entityName, query: searchQuery, filters, limit }) => {
        const entity = coreRegistry.get(entityName);
        if (!entity) {
          throw new Error(
            `Unknown entity "${entityName}". Available entities: ${Array.from(coreRegistry.keys()).join(", ")}`
          );
        }

        const result = await entityService.list(supabase, entity, {
          search: searchQuery,
          filters,
          limit,
        });

        if (!result.success) {
          throw new Error(`Search failed: ${formatServiceError(result.error)}`);
        }

        return result.data;
      },
    }),

    getEntityDetail: tool({
      description:
        "Get full details for a single entity record by ID. Works with any entity type registered in the system.",
      inputSchema: z.object({
        entityName: z
          .string()
          .describe("Entity name (snake_case)"),
        id: z.string().uuid().describe("The record UUID"),
      }),
      execute: async ({ entityName, id }) => {
        const entity = coreRegistry.get(entityName);
        if (!entity) {
          throw new Error(
            `Unknown entity "${entityName}". Available entities: ${Array.from(coreRegistry.keys()).join(", ")}`
          );
        }

        const result = await entityService.getById(supabase, entity, id);

        if (!result.success) {
          throw new Error(
            `Failed to get ${entity.displayName}: ${formatServiceError(result.error)}`
          );
        }

        return result.data;
      },
    }),

    // =========================================================================
    // SQL Function Tools (via Supabase RPC)
    // =========================================================================

    analyzeRecipe: tool({
      description:
        "Analyze a recipe against its target BJCP style guidelines. Returns compliance status for OG, FG, ABV, IBU, SRM.",
      inputSchema: z.object({
        recipeId: z.string().uuid().describe("The recipe UUID"),
      }),
      execute: ({ recipeId }) =>
        rpc(supabase, "analyze_recipe_style_compliance", { p_recipe_id: recipeId }),
    }),

    getRecipeSummary: tool({
      description:
        "Get a comprehensive recipe summary including grain bill, hop schedule, yeast, water profile, mash/fermentation schedules, and calculated estimates.",
      inputSchema: z.object({
        recipeId: z.string().uuid().describe("The recipe UUID"),
      }),
      execute: ({ recipeId }) =>
        rpc(supabase, "get_recipe_summary", { p_recipe_id: recipeId }),
    }),

    suggestImprovements: tool({
      description:
        "Get improvement suggestions for a recipe based on brewing best practices, style compliance, yeast health, grain bill composition, and water chemistry.",
      inputSchema: z.object({
        recipeId: z.string().uuid().describe("The recipe UUID"),
      }),
      execute: ({ recipeId }) =>
        rpc(supabase, "suggest_recipe_improvements", { p_recipe_id: recipeId }),
    }),

    analyzeBatch: tool({
      description:
        "Analyze batch performance by comparing actual measurements (OG, FG, ABV) against recipe targets. Includes fermentation timeline and latest readings.",
      inputSchema: z.object({
        batchId: z.string().uuid().describe("The batch UUID"),
      }),
      execute: ({ batchId }) =>
        rpc(supabase, "analyze_batch_performance", { p_batch_id: batchId }),
    }),

    getInventoryOverview: tool({
      description:
        "Get a snapshot of current inventory: finished goods, raw materials with available quantities, and batches in progress.",
      inputSchema: z.object({}),
      execute: () => rpc(supabase, "get_inventory_overview", {}),
    }),

    // =========================================================================
    // Specialized Query Tools (custom joins, aggregations, or views)
    // =========================================================================

    getBatchStatus: tool({
      description:
        "Get a summary of all batches grouped by status (planned, fermenting, conditioning, etc.). Useful for production overview.",
      inputSchema: z.object({}),
      execute: async () => {
        const data = await query<{ status: string; count: number }[]>(
          dynamicFrom(supabase, "batch_status_counts").select("status, count"),
        );
        const summary: Record<string, number> = {};
        for (const { status, count } of data) {
          if (status !== "cancelled") {
            summary[status] = count;
          }
        }
        return summary;
      },
    }),

    getVesselAvailability: tool({
      description:
        "Get vessel utilization: which vessels are available, which are in use with their current batch assignments, and the projected date each occupied vessel frees up (based on the batch's recipe schedule).",
      inputSchema: z.object({}),
      execute: async () => {
        const data = await query<
          {
            id: string;
            name: string;
            vessel_type: string;
            capacity_bbl: number;
            status: string;
            current_batch_id: string | null;
            batch_code: string | null;
          }[]
        >(
          dynamicFrom(supabase, "vessels_with_batch")
            .select(
              "id, name, vessel_type, capacity_bbl, status, current_batch_id, batch_code"
            )
            .eq("is_active", true)
            .order("name"),
        );
        const available = data.filter(
          (v) => v.status === "ready_for_use" && !v.current_batch_id
        );
        const inUse = data.filter((v) => v.current_batch_id);

        // Projected free date per occupying batch: planned_start_date +
        // fermentation_days + conditioning_days via the shared schedule math
        // in src/domain/batch-schedule.ts (14/7-day fallbacks included).
        // Null when the batch has no planned start date.
        const projectedFreeByBatch = new Map<string, string | null>();
        const occupyingBatchIds = inUse
          .map((v) => v.current_batch_id)
          .filter((id): id is string => id !== null);
        if (occupyingBatchIds.length > 0) {
          const batches = await query(
            supabase
              .from("batches")
              .select(
                "id, planned_start_date, recipes:recipe_id(fermentation_days, conditioning_days)"
              )
              .in("id", occupyingBatchIds),
          );
          for (const b of batches ?? []) {
            const recipe = b.recipes as {
              fermentation_days: number | null;
              conditioning_days: number | null;
            } | null;
            projectedFreeByBatch.set(
              b.id,
              projectedReadyDate(b.planned_start_date, recipe),
            );
          }
        }

        return {
          summary: {
            total: data.length,
            available: available.length,
            inUse: inUse.length,
          },
          available: available.map((v) => ({
            id: v.id,
            name: v.name,
            type: v.vessel_type,
            capacity_bbl: v.capacity_bbl,
          })),
          inUse: inUse.map((v) => ({
            id: v.id,
            name: v.name,
            type: v.vessel_type,
            capacity_bbl: v.capacity_bbl,
            batch_code: v.batch_code,
            projected_free_date: v.current_batch_id
              ? (projectedFreeByBatch.get(v.current_batch_id) ?? null)
              : null,
          })),
        };
      },
    }),

    getProductionSchedule: tool({
      description:
        "Get batches scheduled within a date range. Includes recipe name and volume.",
      inputSchema: z.object({
        startDate: z.string().describe("Start date (YYYY-MM-DD)"),
        endDate: z.string().describe("End date (YYYY-MM-DD)"),
      }),
      execute: async ({ startDate, endDate }) =>
        query(
          supabase
            .from("batches")
            .select(
              "id, batch_code, status, planned_start_date, recipe:recipes(name, volume_bbl, fermentation_days, conditioning_days)"
            )
            .gte("planned_start_date", startDate)
            .lte("planned_start_date", endDate)
            .neq("status", "cancelled")
            .order("planned_start_date"),
        ),
    }),

    getIngredientInventory: tool({
      description:
        "Get raw ingredient inventory levels. Optionally filter by category (malt, hop, yeast, adjunct, chemical) and/or by item name (partial match). Returns totals per item.",
      inputSchema: z.object({
        category: z
          .string()
          .optional()
          .describe("Filter by category: malt, hop, yeast, adjunct, chemical"),
        itemName: z
          .string()
          .optional()
          .describe(
            "Filter by item name, case-insensitive partial match (e.g. 'citra')",
          ),
      }),
      execute: async ({ category, itemName }) => {
        // Fetch active items, then lots from the view that accounts for
        // allocations (remaining_quantity = received - allocated).
        let itemsQ = dynamicFrom(supabase, "inventory_items")
          .select("id, name, category, unit, reorder_point")
          .eq("is_active", true);
        if (category) itemsQ = itemsQ.eq("category", category);
        if (itemName)
          itemsQ = itemsQ.ilike("name", `%${escapeIlikePattern(itemName)}%`);

        const items = await query<{ id: string; name: string; category: string; unit: string; reorder_point: number | null }[]>(itemsQ);
        if (!items?.length) return [];

        const lots = await query<{ inventory_item_id: string | null; remaining_quantity: number; expiration_date: string | null }[]>(
          dynamicFrom(supabase, "inventory_lots_with_quantities")
            .select("inventory_item_id, remaining_quantity, expiration_date")
            .in("inventory_item_id", items.map((i) => i.id))
            .gt("remaining_quantity", 0),
        );

        // Group lots by item
        const lotsByItem = new Map<string, typeof lots>();
        for (const lot of lots ?? []) {
          if (!lot.inventory_item_id) continue;
          const arr = lotsByItem.get(lot.inventory_item_id);
          if (arr) arr.push(lot);
          else lotsByItem.set(lot.inventory_item_id, [lot]);
        }

        return items.map((item) => {
          const itemLots = lotsByItem.get(item.id) ?? [];
          const expirationDates = itemLots
            .map((lot) => lot.expiration_date)
            .filter((d): d is string => d !== null);

          return {
            id: item.id,
            name: item.name,
            category: item.category,
            unit: item.unit,
            reorder_point: item.reorder_point,
            total_quantity: itemLots.reduce((sum, lot) => sum + lot.remaining_quantity, 0),
            earliest_expiration:
              expirationDates.length > 0 ? expirationDates.sort()[0] : null,
            lot_count: itemLots.length,
          };
        });
      },
    }),

    getBatchLogs: tool({
      description:
        "Get the event log for a batch: gravity readings, status changes, measurements, and notes. Ordered chronologically.",
      inputSchema: z.object({
        batchId: z.string().uuid().describe("The batch UUID"),
      }),
      execute: async ({ batchId }) =>
        query(
          supabase
            .from("batch_logs")
            .select("id, log_type, data, created_at, created_by_name")
            .eq("batch_id", batchId)
            .order("created_at", { ascending: true }),
        ),
    }),

    getVesselCleanings: tool({
      description:
        "Get cleaning history for a vessel: cleaning type (CIP, caustic, acid, sanitize), chemicals used, duration, and dates.",
      inputSchema: z.object({
        vesselId: z.string().uuid().describe("The vessel UUID"),
      }),
      execute: async ({ vesselId }) =>
        query(
          supabase
            .from("vessel_cleanings")
            .select(
              "id, cleaning_type, from_status, to_status, duration_min, chemicals_used, notes, created_at"
            )
            .eq("vessel_id", vesselId)
            .order("created_at", { ascending: false })
            .limit(20),
        ),
    }),

    getBatchTransfers: tool({
      description:
        "Get the transfer history for a batch: which vessels it moved between, volumes, and dates.",
      inputSchema: z.object({
        batchId: z.string().uuid().describe("The batch UUID"),
      }),
      execute: async ({ batchId }) =>
        query(
          supabase
            .from("vessel_transfers")
            .select(
              "id, from_vessel:vessels!vessel_transfers_from_vessel_id_fkey(name), to_vessel:vessels!vessel_transfers_to_vessel_id_fkey(name), volume_bbl, transfer_type, notes, transferred_at"
            )
            .eq("batch_id", batchId)
            .order("transferred_at", { ascending: true }),
        ),
    }),

    getRecipeCost: tool({
      description:
        "Get the cost breakdown (COGS) for a recipe including ingredient costs per batch.",
      inputSchema: z.object({
        recipeId: z.string().uuid().describe("The recipe UUID"),
      }),
      execute: async ({ recipeId }) =>
        query(
          supabase
            .from("recipes_with_cogs")
            .select(
              "id, name, volume_bbl, malt_cost, hop_cost, yeast_cost, adjunct_cost, total_cogs, cogs_per_bbl"
            )
            .eq("id", recipeId)
            .single(),
        ),
    }),

    getLotExpiration: tool({
      description:
        "Get ingredient lots expiring within a given number of days. Useful for identifying inventory that needs to be used soon.",
      inputSchema: z.object({
        daysAhead: z
          .number()
          .optional()
          .default(30)
          .describe("Number of days to look ahead for expiring lots"),
      }),
      execute: async ({ daysAhead }) => {
        const result = await inventoryService.getExpiringLots(supabase, daysAhead);
        if (!result.success) throw new Error(formatServiceError(result.error));
        return result.data;
      },
    }),

    // Config-driven single-table search tools (getFinishedGoods, searchOrders,
    // getCustomers, searchBrewLogs, searchPurchaseOrders, searchSuppliers,
    // searchPickLists, searchYeastPitches, getKegInventory) — see
    // ./search-tools.ts for their configs and the shared factory.
    ...createSearchTools(supabase),

    lookupEntity: tool({
      description:
        "Resolve a human-friendly name to a UUID. Searches batches (by number), recipes (by name), customers (by name), brands (by name), and orders (by number). Use this when you need a UUID for another tool.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("The name or number to search for (e.g. 'batch 42', 'Hazy IPA')"),
        entityType: z
          .enum(["batch", "recipe", "customer", "brand", "order"])
          .optional()
          .describe("Narrow search to a specific entity type"),
      }),
      execute: async ({ query: searchQuery, entityType }) => {
        type Result = { type: string; id: string; display: string };
        const escaped = escapeIlikePattern(searchQuery);
        const should = (t: string) => !entityType || entityType === t;

        const queries: PromiseLike<Result[]>[] = [];

        if (should("batch")) {
          const batchSelect = "id, batch_code, name" as const;
          const toResult = (b: { id: string; batch_code: string; name: string | null }) => ({
            type: "batch" as const,
            id: b.id,
            display: `${b.batch_code}${b.name ? ` — ${b.name}` : ""}`,
          });
          queries.push(
            Promise.all([
              supabase
                .from("batches")
                .select(batchSelect)
                .ilike("batch_code", `%${escaped}%`)
                .limit(5),
              supabase
                .from("batches")
                .select(batchSelect)
                .ilike("name", `%${escaped}%`)
                .limit(5),
            ]).then(([byNumber, byName]) => {
              const seen = new Set<string>();
              const results: Result[] = [];
              for (const row of [...(byNumber.data || []), ...(byName.data || [])]) {
                if (!seen.has(row.id)) {
                  seen.add(row.id);
                  results.push(toResult(row));
                }
              }
              return results.slice(0, 5);
            })
          );
        }

        // The remaining four are the same query with a different table and
        // display column, so they are driven off a table rather than written
        // out four times. Batches stay bespoke above: they match on two
        // columns and de-duplicate across them.
        for (const target of LOOKUP_TARGETS) {
          if (!should(target.type)) continue;
          let q = dynamicFrom(supabase, target.table)
            .select(`id, ${target.column}`)
            .ilike(target.column, `%${escaped}%`);
          if (target.activeOnly) q = q.eq("is_active", true);
          queries.push(
            q.limit(5).then(({ data }: { data: Record<string, string>[] | null }) =>
              (data || []).map((row) => ({
                type: target.type,
                id: row.id,
                display: row[target.column],
              })),
            ),
          );
        }

        const allResults = await Promise.all(queries);
        return allResults.flat();
      },
    }),

    getOrderDetail: tool({
      description:
        "Get full details for an order including line items with brand, selling format, quantity, and price.",
      inputSchema: z.object({
        orderId: z.string().uuid().describe("The order UUID"),
      }),
      execute: async ({ orderId }) => {
        const { data, error } = await supabase
          .from("orders")
          .select(
            `id, order_number, status, order_date, requested_date, scheduled_date, fulfilled_date, shipping_address, notes,
             customer:customers(id, name, customer_type, email, phone),
             items:order_items(id, quantity, unit_price, notes, brand:brands(id, name), selling_format:selling_formats(id, name), batch:batches(id, batch_code))`
          )
          .eq("id", orderId)
          .single();
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    getAppGuide: tool({
      description:
        "Get the MGR application guide with navigation instructions, feature descriptions, and common workflows. Use when a user asks how to do something in the app.",
      inputSchema: z.object({}),
      execute: async () => getHelpContentForSystemPrompt(),
    }),

    // =========================================================================
    // Confirm-gated write tools. Each returns a ConfirmWriteIntent and
    // persists nothing; the client renders a Confirm/Cancel card and POSTs to
    // /api/chat/write. Before Phase 4B these navigated to a pre-filled form.
    // =========================================================================

    createBatch: tool({
      description:
        "Create a new planned batch from a recipe. Returns a pending write the user must confirm before anything is saved.",
      inputSchema: z.object({
        recipeName: z
          .string()
          .optional()
          .describe("Recipe name to search for"),
        recipeId: z.string().uuid().optional().describe("Recipe UUID if known"),
        name: z
          .string()
          .optional()
          .describe("Batch name. Defaults to the recipe name."),
        plannedStartDate: z
          .string()
          .optional()
          .describe("Planned start date (YYYY-MM-DD)"),
        targetVolumeBbl: z
          .number()
          .optional()
          .describe("Target volume in barrels"),
      }),
      execute: async ({
        recipeName,
        recipeId,
        name,
        plannedStartDate,
        targetVolumeBbl,
      }): Promise<ConfirmWriteIntent> => {
        let recipe: {
          id: string;
          name: string;
          volume_bbl: number | null;
        } | null = null;

        if (recipeId) {
          const { data, error } = await supabase
            .from("recipes")
            .select("id, name, volume_bbl")
            .eq("id", recipeId)
            .single();
          if (error) throw new Error(`Recipe not found: ${error.message}`);
          recipe = data;
        } else if (recipeName) {
          const { data, error } = await supabase
            .from("recipes")
            .select("id, name, volume_bbl")
            .ilike("name", `%${escapeIlikePattern(recipeName)}%`)
            .limit(1);
          if (error) throw new Error(error.message);
          if (!data || data.length === 0) {
            throw new Error(
              `No recipe found matching "${recipeName}". Use searchEntity with entityName "recipe" to find the right name.`
            );
          }
          recipe = data[0];
        } else {
          throw new Error("Either recipeName or recipeId is required");
        }

        const volumeBbl = targetVolumeBbl ?? recipe.volume_bbl ?? undefined;
        const batchName = name?.trim() || recipe.name;

        const datePart = plannedStartDate
          ? ` planned for ${plannedStartDate}`
          : "";
        const volumePart = volumeBbl ? ` at ${volumeBbl} bbl` : "";
        return {
          action: "confirm_write" as const,
          writeAction: "create_batch" as const,
          params: {
            recipeId: recipe.id,
            name: batchName,
            ...(plannedStartDate ? { plannedStartDate } : {}),
            ...(volumeBbl !== undefined ? { volumeBbl } : {}),
          },
          description: `Create planned batch "${batchName}" from ${recipe.name}${volumePart}${datePart}`,
        };
      },
    }),

    transitionBatch: tool({
      description:
        "Move a batch to a new state (fermenting, conditioning, packaging, completed). Returns a pending write the user must confirm before it is applied. Cancelling or archiving a batch is not available here — those run their own RPCs.",
      inputSchema: z.object({
        batchId: z.string().uuid().optional().describe("The batch UUID"),
        batchNumber: z
          .string()
          .optional()
          .describe("The batch number to search for"),
        toState: z
          .enum([
            "fermenting",
            "conditioning",
            "packaging",
            "completed",
          ])
          .describe("Target state"),
      }),
      execute: async ({ batchId, batchNumber, toState }) => {
        const batch = await resolveBatch(supabase, batchId, batchNumber);

        // Single source of truth: batchTransitions lives in the server-safe
        // src/lib/schemas/batch.ts (zod only, no React), so import it directly
        // instead of re-declaring the state machine here.
        const allowed = batchTransitions[batch.status] || [];
        if (!allowed.includes(toState)) {
          throw new Error(
            `Cannot transition batch #${batch.batch_code} from "${batch.status}" to "${toState}". Valid transitions: ${allowed.join(", ") || "none"}`
          );
        }

        // The check above is advisory: it gives the model a useful error rather
        // than a confirmation the server would reject. `/api/chat/write`
        // re-resolves the batch and re-checks the transition before writing,
        // because the batch can move between this proposal and the confirm.
        return {
          action: "confirm_write" as const,
          writeAction: "transition_batch" as const,
          params: { batchId: batch.id, toState },
          description: `Move batch #${batch.batch_code} from ${formatStateLabel(batch.status)} to ${formatStateLabel(toState)}`,
        };
      },
    }),

    // `addBatchReading` (navigational — open the readings form) was removed in
    // Phase 4B in favour of `recordBatchReading` below, which persists the
    // value through the confirmation gate. Two tools for one intent made the
    // model choose between "record the number the user just stated" and "open
    // a form they can already reach from the batch page"; the gated write
    // strictly dominates, so the navigational twin is gone.

    createPackagingSession: tool({
      description:
        "Create a new packaging session on a given date. Returns a pending write the user must confirm before it is saved.",
      inputSchema: z.object({
        sessionDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe("Session date (YYYY-MM-DD)"),
        notes: z
          .string()
          .max(2000)
          .optional()
          .describe("Optional session notes or special instructions"),
      }),
      execute: async ({ sessionDate, notes }) => {
        return {
          action: "confirm_write" as const,
          writeAction: "create_packaging_session" as const,
          params: { sessionDate, ...(notes ? { notes } : {}) },
          description: `Create a packaging session for ${sessionDate}`,
        };
      },
    }),

    // =========================================================================
    // Confirm-Gated Write Tools (return ConfirmWriteIntent; the client
    // confirms, then POSTs to /api/chat/write — no write happens here)
    // =========================================================================

    recordBatchReading: tool({
      description:
        "Record a fermentation reading (gravity, temperature, pH, pressure, dissolved oxygen, diacetyl, clarity) directly on a batch. Use when the user states the measured value in chat. Returns a pending write the user must confirm before it is saved.",
      inputSchema: z.object({
        batchId: z.string().uuid().optional().describe("The batch UUID"),
        batchNumber: z
          .string()
          .optional()
          .describe("The batch number to search for"),
        readingType: z.enum([
          "gravity",
          "temperature",
          "ph",
          "pressure",
          "dissolved_oxygen",
          "diacetyl",
          "clarity",
        ]),
        value: z
          .union([z.number(), z.string()])
          .describe(
            "The measured value. Numeric for most types; for diacetyl one of: absent, trace, present"
          ),
        unit: z
          .string()
          .optional()
          .describe(
            "Unit the value was measured in (gravity: sg|plato, temperature: f|c, clarity: scale|ntu). Defaults to the reading type's default unit."
          ),
        notes: z.string().optional().describe("Optional reading notes"),
      }),
      execute: async ({
        batchId,
        batchNumber,
        readingType,
        value,
        unit,
        notes,
      }): Promise<ConfirmWriteIntent> => {
        const batch = await resolveBatch(supabase, batchId, batchNumber);

        if (
          !READING_ELIGIBLE_STATES.includes(
            batch.status as (typeof READING_ELIGIBLE_STATES)[number]
          )
        ) {
          throw new Error(
            `Batch #${batch.batch_code} is "${batch.status}" — readings can only be added to batches that are ${READING_ELIGIBLE_STATES.join(", ")}.`
          );
        }

        const type = readingType as ReadingType;
        const config = READING_TYPES[type];
        const resolvedUnit = unit ?? config.defaultUnit;
        if (!config.units.includes(resolvedUnit)) {
          throw new Error(
            `Invalid unit "${resolvedUnit}" for ${config.label}. Valid units: ${config.units.join(", ")}`
          );
        }

        const validation = validateReading(type, value);
        if (!validation.valid) {
          throw new Error(
            `Invalid ${config.label} value: ${validation.warning ?? String(value)}`
          );
        }

        const formatted = formatReadingValue(type, value, resolvedUnit);
        const warningNote = validation.warning
          ? ` (note: ${validation.warning})`
          : "";

        return {
          action: "confirm_write" as const,
          writeAction: "add_batch_reading" as const,
          params: {
            batchId: batch.id,
            reading: {
              reading_type: type,
              value,
              unit: resolvedUnit,
              timestamp: new Date().toISOString(),
              ...(notes ? { notes } : {}),
            },
          },
          description: `Record ${config.label} reading of ${formatted} for batch #${batch.batch_code}${warningNote}`,
        };
      },
    }),
  };
}
