import { tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatStateLabel } from "@/types/entity";
import { getHelpContentForSystemPrompt } from "@/lib/help-content";

/** Escape LIKE/ILIKE wildcard characters so they match literally. */
function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

/** Resolve a batch by UUID or batch number. Returns `{ id, batch_number, status }`. */
async function resolveBatch(
  supabase: SupabaseClient,
  batchId?: string,
  batchNumber?: string,
): Promise<{ id: string; batch_number: string; status: string }> {
  if (batchId) {
    const { data, error } = await supabase
      .from("batches")
      .select("id, batch_number, status")
      .eq("id", batchId)
      .single();
    if (error) throw new Error(`Batch not found: ${error.message}`);
    return data;
  }
  if (batchNumber) {
    const { data, error } = await supabase
      .from("batches")
      .select("id, batch_number, status")
      .ilike("batch_number", `%${escapeLike(batchNumber)}%`)
      .limit(1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0)
      throw new Error(`No batch found matching "${batchNumber}"`);
    return data[0];
  }
  throw new Error("Either batchId or batchNumber is required");
}

/**
 * Create chat tools bound to an authenticated Supabase client.
 * Read tools query data directly. Navigation tools return a NavigationIntent
 * that the client renders as an action card — the user reviews and submits.
 */
export function createChatTools(supabase: SupabaseClient) {
  return {
    // =========================================================================
    // SQL Function Tools (via Supabase RPC)
    // =========================================================================

    analyzeRecipe: tool({
      description:
        "Analyze a recipe against its target BJCP style guidelines. Returns compliance status for OG, FG, ABV, IBU, SRM.",
      inputSchema: z.object({
        recipeId: z.string().uuid().describe("The recipe UUID"),
      }),
      execute: async ({ recipeId }) => {
        const { data, error } = await supabase.rpc(
          "analyze_recipe_style_compliance",
          { p_recipe_id: recipeId }
        );
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    getRecipeSummary: tool({
      description:
        "Get a comprehensive recipe summary including grain bill, hop schedule, yeast, water profile, mash/fermentation schedules, and calculated estimates.",
      inputSchema: z.object({
        recipeId: z.string().uuid().describe("The recipe UUID"),
      }),
      execute: async ({ recipeId }) => {
        const { data, error } = await supabase.rpc("get_recipe_summary", {
          p_recipe_id: recipeId,
        });
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    suggestImprovements: tool({
      description:
        "Get improvement suggestions for a recipe based on brewing best practices, style compliance, yeast health, grain bill composition, and water chemistry.",
      inputSchema: z.object({
        recipeId: z.string().uuid().describe("The recipe UUID"),
      }),
      execute: async ({ recipeId }) => {
        const { data, error } = await supabase.rpc(
          "suggest_recipe_improvements",
          { p_recipe_id: recipeId }
        );
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    analyzeBatch: tool({
      description:
        "Analyze batch performance by comparing actual measurements (OG, FG, ABV) against recipe targets. Includes fermentation timeline and latest readings.",
      inputSchema: z.object({
        batchId: z.string().uuid().describe("The batch UUID"),
      }),
      execute: async ({ batchId }) => {
        const { data, error } = await supabase.rpc(
          "analyze_batch_performance",
          { p_batch_id: batchId }
        );
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    getInventoryOverview: tool({
      description:
        "Get a snapshot of current inventory: finished goods, raw materials with available quantities, and batches in progress.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await supabase.rpc("get_inventory_overview");
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    // =========================================================================
    // Query Helper Tools (direct Supabase queries)
    // =========================================================================

    searchRecipes: tool({
      description: "Search recipes by name. Returns recipe details with style info.",
      inputSchema: z.object({
        query: z.string().describe("Search term to match against recipe names"),
        limit: z.number().optional().default(10).describe("Max results to return"),
      }),
      execute: async ({ query, limit }) => {
        const { data, error } = await supabase
          .from("recipes_with_estimates")
          .select("id, name, status, volume_bbl, est_og, est_fg, est_abv, est_ibu, est_srm, style:beer_styles(id, name, category)")
          .ilike("name", `%${escapeLike(query)}%`)
          .limit(limit);
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    getBatchStatus: tool({
      description:
        "Get a summary of all batches grouped by status (planned, fermenting, conditioning, etc.). Useful for production overview.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await supabase
          .from("batches")
          .select("status")
          .neq("status", "cancelled");
        if (error) throw new Error(error.message);
        const summary: Record<string, number> = {};
        for (const batch of data || []) {
          summary[batch.status] = (summary[batch.status] || 0) + 1;
        }
        return summary;
      },
    }),

    getVesselAvailability: tool({
      description:
        "Get vessel utilization: which vessels are available, which are in use, and their current batch assignments.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await supabase
          .from("vessels_with_batch")
          .select(
            "id, name, vessel_type, capacity_bbl, status, current_batch_id, batch_number"
          )
          .eq("is_active", true)
          .order("name");
        if (error) throw new Error(error.message);
        const available = data?.filter(
          (v) => v.status === "ready_for_use" && !v.current_batch_id
        );
        const inUse = data?.filter((v) => v.current_batch_id);
        return {
          summary: {
            total: data?.length || 0,
            available: available?.length || 0,
            inUse: inUse?.length || 0,
          },
          available: available?.map((v) => ({ id: v.id, name: v.name, type: v.vessel_type, capacity_bbl: v.capacity_bbl })),
          inUse: inUse?.map((v) => ({ id: v.id, name: v.name, type: v.vessel_type, capacity_bbl: v.capacity_bbl, batch_number: v.batch_number })),
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
      execute: async ({ startDate, endDate }) => {
        const { data, error } = await supabase
          .from("batches")
          .select(
            "id, batch_number, status, planned_start_date, recipe:recipes(name, volume_bbl, fermentation_days, conditioning_days)"
          )
          .gte("planned_start_date", startDate)
          .lte("planned_start_date", endDate)
          .neq("status", "cancelled")
          .order("planned_start_date");
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    getIngredientInventory: tool({
      description:
        "Get raw ingredient inventory levels. Optionally filter by category (malt, hop, yeast, adjunct, chemical). Returns totals per item.",
      inputSchema: z.object({
        category: z
          .string()
          .optional()
          .describe("Filter by category: malt, hop, yeast, adjunct, chemical"),
      }),
      execute: async ({ category }) => {
        let query = supabase.from("inventory_items").select(
          "id, name, category, unit, reorder_point, inventory_lots(quantity, expiration_date)"
        );
        if (category) {
          query = query.eq("category", category);
        }
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return (data as Array<{
          id: string;
          name: string;
          category: string;
          unit: string;
          reorder_point: number | null;
          inventory_lots: Array<{ quantity: number; expiration_date: string | null }>;
        }>)?.map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category,
          unit: item.unit,
          reorder_point: item.reorder_point,
          total_quantity:
            item.inventory_lots?.reduce((sum, lot) => sum + lot.quantity, 0) || 0,
          earliest_expiration: item.inventory_lots?.reduce(
            (earliest: string | null, lot) => {
              if (!lot.expiration_date) return earliest;
              if (!earliest) return lot.expiration_date;
              return lot.expiration_date < earliest ? lot.expiration_date : earliest;
            },
            null as string | null
          ),
          lot_count: item.inventory_lots?.length || 0,
        }));
      },
    }),

    // =========================================================================
    // New Tools (data not previously accessible to AI)
    // =========================================================================

    getBatchLogs: tool({
      description:
        "Get the event log for a batch: gravity readings, status changes, measurements, and notes. Ordered chronologically.",
      inputSchema: z.object({
        batchId: z.string().uuid().describe("The batch UUID"),
      }),
      execute: async ({ batchId }) => {
        const { data, error } = await supabase
          .from("batch_logs")
          .select("id, log_type, data, created_at, created_by_name")
          .eq("batch_id", batchId)
          .order("created_at", { ascending: true });
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    getVesselCleanings: tool({
      description:
        "Get cleaning history for a vessel: cleaning type (CIP, caustic, acid, sanitize), chemicals used, duration, and dates.",
      inputSchema: z.object({
        vesselId: z.string().uuid().describe("The vessel UUID"),
      }),
      execute: async ({ vesselId }) => {
        const { data, error } = await supabase
          .from("vessel_cleanings")
          .select(
            "id, cleaning_type, from_status, to_status, duration_min, chemicals_used, notes, created_at"
          )
          .eq("vessel_id", vesselId)
          .order("created_at", { ascending: false })
          .limit(20);
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    getBatchTransfers: tool({
      description:
        "Get the transfer history for a batch: which vessels it moved between, volumes, and dates.",
      inputSchema: z.object({
        batchId: z.string().uuid().describe("The batch UUID"),
      }),
      execute: async ({ batchId }) => {
        const { data, error } = await supabase
          .from("vessel_transfers")
          .select(
            "id, from_vessel:vessels!vessel_transfers_from_vessel_id_fkey(name), to_vessel:vessels!vessel_transfers_to_vessel_id_fkey(name), volume_bbl, transfer_type, notes, transferred_at"
          )
          .eq("batch_id", batchId)
          .order("transferred_at", { ascending: true });
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    getRecipeCost: tool({
      description:
        "Get the cost breakdown (COGS) for a recipe including ingredient costs per batch.",
      inputSchema: z.object({
        recipeId: z.string().uuid().describe("The recipe UUID"),
      }),
      execute: async ({ recipeId }) => {
        const { data, error } = await supabase
          .from("recipes_with_cogs")
          .select("id, name, volume_bbl, malt_cost, hop_cost, yeast_cost, adjunct_cost, total_cogs, cogs_per_bbl")
          .eq("id", recipeId)
          .single();
        if (error) throw new Error(error.message);
        return data;
      },
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
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() + daysAhead);
        const { data, error } = await supabase
          .from("inventory_lots_with_quantities")
          .select("*")
          .not("expiration_date", "is", null)
          .lte("expiration_date", cutoff.toISOString().split("T")[0])
          .gt("available_quantity", 0)
          .order("expiration_date", { ascending: true });
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    getBatchDetail: tool({
      description:
        "Get full details for a specific batch by UUID or batch number. Returns batch info, recipe name, current vessel, brew dates, and status.",
      inputSchema: z.object({
        batchId: z.string().uuid().optional().describe("The batch UUID"),
        batchNumber: z
          .string()
          .optional()
          .describe("The batch number (e.g. '42' or 'B-042')"),
      }),
      execute: async ({ batchId, batchNumber }) => {
        let query = supabase
          .from("batches_with_brew_info")
          .select(
            "id, batch_number, name, status, volume_bbl, planned_start_date, actual_og, actual_fg, actual_abv, brew_date, current_vessel_name, notes, recipe:recipes(id, name)"
          );
        if (batchId) {
          query = query.eq("id", batchId);
        } else if (batchNumber) {
          query = query.ilike("batch_number", `%${escapeLike(batchNumber)}%`);
        } else {
          throw new Error("Either batchId or batchNumber is required");
        }
        const { data, error } = batchId
          ? await query.single()
          : await query.limit(5);
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    searchBatches: tool({
      description:
        "Search and filter batches by status, recipe name, date range, or batch number. Returns matching batches with recipe and vessel info.",
      inputSchema: z.object({
        status: z
          .string()
          .optional()
          .describe(
            "Filter by status: planned, fermenting, conditioning, packaging, completed, cancelled, archived"
          ),
        recipeName: z
          .string()
          .optional()
          .describe("Filter by recipe name (partial match)"),
        startDate: z.string().optional().describe("Start of date range (YYYY-MM-DD)"),
        endDate: z.string().optional().describe("End of date range (YYYY-MM-DD)"),
        batchNumber: z.string().optional().describe("Filter by batch number (partial match)"),
        limit: z.number().optional().default(20).describe("Max results"),
      }),
      execute: async ({ status, recipeName, startDate, endDate, batchNumber, limit }) => {
        let query = supabase
          .from("batches_with_brew_info")
          .select(
            "id, batch_number, name, status, volume_bbl, planned_start_date, brew_date, current_vessel_name, recipe:recipes(id, name)"
          )
          .order("planned_start_date", { ascending: false })
          .limit(limit);

        if (status) query = query.eq("status", status);
        if (batchNumber)
          query = query.ilike("batch_number", `%${escapeLike(batchNumber)}%`);
        if (startDate) query = query.gte("planned_start_date", startDate);
        if (endDate) query = query.lte("planned_start_date", endDate);

        const { data, error } = await query;
        if (error) throw new Error(error.message);

        if (recipeName && data) {
          const lower = recipeName.toLowerCase();
          return data.filter(
            (b: Record<string, unknown>) => {
              const recipe = b.recipe as { name: string } | null;
              return recipe?.name?.toLowerCase().includes(lower);
            }
          );
        }
        return data;
      },
    }),

    getBrands: tool({
      description: "Search brands by name. Returns brand info with style.",
      inputSchema: z.object({
        query: z.string().optional().describe("Search by brand name"),
        limit: z.number().optional().default(20).describe("Max results"),
      }),
      execute: async ({ query, limit }) => {
        let q = supabase
          .from("brands")
          .select("id, name, variant, abv, description, style:beer_styles(id, name)")
          .order("name")
          .limit(limit);

        if (query) q = q.ilike("name", `%${escapeLike(query)}%`);

        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    getFinishedGoods: tool({
      description:
        "Get finished goods inventory with availability. Filter by brand or package type.",
      inputSchema: z.object({
        brandId: z.string().uuid().optional().describe("Filter by brand UUID"),
        query: z.string().optional().describe("Search by brand name"),
        limit: z.number().optional().default(20).describe("Max results"),
      }),
      execute: async ({ brandId, query, limit }) => {
        let q = supabase
          .from("finished_goods_with_availability")
          .select(
            "id, lot_number, brand_name, package_type_name, total_quantity, allocated_quantity, reserved_quantity, available_quantity, production_date, best_by_date"
          )
          .gt("available_quantity", 0)
          .order("brand_name")
          .limit(limit);

        if (brandId) q = q.eq("brand_id", brandId);

        const { data, error } = await q;
        if (error) throw new Error(error.message);

        if (query && data) {
          const lower = query.toLowerCase();
          return data.filter(
            (fg: Record<string, unknown>) =>
              typeof fg.brand_name === "string" &&
              fg.brand_name.toLowerCase().includes(lower)
          );
        }
        return data;
      },
    }),

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
      execute: async ({ query, entityType }) => {
        type Result = { type: string; id: string; display: string };
        const escaped = escapeLike(query);
        const should = (t: string) => !entityType || entityType === t;

        const queries: PromiseLike<Result[]>[] = [];

        if (should("batch")) {
          queries.push(
            supabase
              .from("batches")
              .select("id, batch_number, name")
              .or(`batch_number.ilike.%${escaped}%,name.ilike.%${escaped}%`)
              .limit(5)
              .then(({ data }) =>
                (data || []).map((b) => ({
                  type: "batch",
                  id: b.id,
                  display: `${b.batch_number}${b.name ? ` — ${b.name}` : ""}`,
                }))
              )
          );
        }

        if (should("recipe")) {
          queries.push(
            supabase
              .from("recipes")
              .select("id, name")
              .ilike("name", `%${escaped}%`)
              .limit(5)
              .then(({ data }) =>
                (data || []).map((r) => ({ type: "recipe", id: r.id, display: r.name }))
              )
          );
        }

        if (should("customer")) {
          queries.push(
            supabase
              .from("customers")
              .select("id, name")
              .ilike("name", `%${escaped}%`)
              .eq("is_active", true)
              .limit(5)
              .then(({ data }) =>
                (data || []).map((c) => ({ type: "customer", id: c.id, display: c.name }))
              )
          );
        }

        if (should("brand")) {
          queries.push(
            supabase
              .from("brands")
              .select("id, name")
              .ilike("name", `%${escaped}%`)
              .limit(5)
              .then(({ data }) =>
                (data || []).map((b) => ({ type: "brand", id: b.id, display: b.name }))
              )
          );
        }

        if (should("order")) {
          queries.push(
            supabase
              .from("orders")
              .select("id, order_number")
              .ilike("order_number", `%${escaped}%`)
              .limit(5)
              .then(({ data }) =>
                (data || []).map((o) => ({ type: "order", id: o.id, display: o.order_number }))
              )
          );
        }

        const allResults = await Promise.all(queries);
        return allResults.flat();
      },
    }),

    searchOrders: tool({
      description:
        "Search orders by status, customer name, or date range. Returns order headers with customer info.",
      inputSchema: z.object({
        status: z
          .string()
          .optional()
          .describe(
            "Filter by status: draft, confirmed, scheduled, picking, packed, fulfilled, cancelled"
          ),
        customerName: z
          .string()
          .optional()
          .describe("Filter by customer name (partial match)"),
        startDate: z
          .string()
          .optional()
          .describe("Order date start (YYYY-MM-DD)"),
        endDate: z
          .string()
          .optional()
          .describe("Order date end (YYYY-MM-DD)"),
        limit: z.number().optional().default(20).describe("Max results"),
      }),
      execute: async ({ status, customerName, startDate, endDate, limit }) => {
        let query = supabase
          .from("orders")
          .select(
            "id, order_number, status, order_date, requested_date, scheduled_date, notes, customer:customers(id, name)"
          )
          .order("order_date", { ascending: false })
          .limit(limit);

        if (status) query = query.eq("status", status);
        if (startDate) query = query.gte("order_date", startDate);
        if (endDate) query = query.lte("order_date", endDate);

        const { data, error } = await query;
        if (error) throw new Error(error.message);

        if (customerName && data) {
          const lower = customerName.toLowerCase();
          return data.filter((o: Record<string, unknown>) => {
            const customer = o.customer as { name: string } | null;
            return customer?.name?.toLowerCase().includes(lower);
          });
        }
        return data;
      },
    }),

    getOrderDetail: tool({
      description:
        "Get full details for an order including line items with brand, package type, quantity, and price.",
      inputSchema: z.object({
        orderId: z.string().uuid().describe("The order UUID"),
      }),
      execute: async ({ orderId }) => {
        const { data, error } = await supabase
          .from("orders")
          .select(
            `id, order_number, status, order_date, requested_date, scheduled_date, fulfilled_date, shipping_address, notes,
             customer:customers(id, name, customer_type, email, phone),
             items:order_items(id, quantity, unit_price, notes, brand:brands(id, name), package_type:package_types(id, name, volume_oz), batch:batches(id, batch_number))`
          )
          .eq("id", orderId)
          .single();
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    getCustomers: tool({
      description:
        "Search customers by name. Returns customer info with order statistics.",
      inputSchema: z.object({
        query: z.string().optional().describe("Search by customer name"),
        limit: z.number().optional().default(20).describe("Max results"),
      }),
      execute: async ({ query, limit }) => {
        let q = supabase
          .from("customers_with_order_summary")
          .select(
            "id, name, customer_type, contact_name, email, phone, total_orders, total_revenue, pending_orders, last_order_date"
          )
          .eq("is_active", true)
          .order("name")
          .limit(limit);

        if (query) q = q.ilike("name", `%${escapeLike(query)}%`);

        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    // =========================================================================
    // Help / Guide Tool
    // =========================================================================

    getAppGuide: tool({
      description:
        "Get the MGR application guide with navigation instructions, feature descriptions, and common workflows. Use when a user asks how to do something in the app.",
      inputSchema: z.object({}),
      execute: async () => getHelpContentForSystemPrompt(),
    }),

    // =========================================================================
    // Navigation Tools (return NavigationIntent for the client to handle)
    // =========================================================================

    createBatch: tool({
      description:
        "Prepare a new batch from a recipe. Returns a navigation action that opens the batch creation form with pre-filled data. The user will review and submit the form.",
      inputSchema: z.object({
        recipeName: z
          .string()
          .optional()
          .describe("Recipe name to search for"),
        recipeId: z.string().uuid().optional().describe("Recipe UUID if known"),
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
        plannedStartDate,
        targetVolumeBbl,
      }) => {
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
            .ilike("name", `%${escapeLike(recipeName)}%`)
            .limit(1);
          if (error) throw new Error(error.message);
          if (!data || data.length === 0) {
            throw new Error(
              `No recipe found matching "${recipeName}". Use searchRecipes to find the right name.`
            );
          }
          recipe = data[0];
        } else {
          throw new Error("Either recipeName or recipeId is required");
        }

        const prefillData: Record<string, unknown> = {
          recipe_id: recipe.id,
        };
        if (plannedStartDate) prefillData.planned_start_date = plannedStartDate;
        if (targetVolumeBbl) {
          prefillData.volume_bbl = targetVolumeBbl;
        } else if (recipe.volume_bbl) {
          prefillData.volume_bbl = recipe.volume_bbl;
        }

        const datePart = plannedStartDate
          ? ` planned for ${plannedStartDate}`
          : "";
        return {
          action: "navigate" as const,
          url: "/production/batches/new",
          prefillData,
          description: `Create a new batch of ${recipe.name}${datePart}`,
        };
      },
    }),

    transitionBatch: tool({
      description:
        "Navigate to a batch to perform a state transition. For transitions with dialogs (start fermentation, cancel, archive), the dialog opens automatically. For simple transitions (conditioning, packaging, complete), navigates to the batch detail page where the user clicks the action.",
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
            "cancelled",
            "archived",
          ])
          .describe("Target state"),
      }),
      execute: async ({ batchId, batchNumber, toState }) => {
        const batch = await resolveBatch(supabase, batchId, batchNumber);

        const validTransitions: Record<string, string[]> = {
          planned: ["fermenting", "cancelled"],
          fermenting: ["conditioning", "archived"],
          conditioning: ["packaging", "archived"],
          packaging: ["completed", "archived"],
        };

        const allowed = validTransitions[batch.status] || [];
        if (!allowed.includes(toState)) {
          throw new Error(
            `Cannot transition batch #${batch.batch_number} from "${batch.status}" to "${toState}". Valid transitions: ${allowed.join(", ") || "none"}`
          );
        }

        const dialogMap: Record<string, string> = {
          fermenting: "start_fermentation",
          cancelled: "cancel",
          archived: "archive",
        };

        const openDialog = dialogMap[toState] as string | undefined;
        const toLabel = formatStateLabel(toState);

        const description = openDialog
          ? `Move batch #${batch.batch_number} from ${batch.status} to ${toLabel}`
          : `Navigate to batch #${batch.batch_number} — click "${toLabel}" in the Actions menu to transition from ${batch.status}`;

        return {
          action: "navigate" as const,
          url: `/production/batches/${batch.id}`,
          openDialog,
          description,
        };
      },
    }),

    addBatchReading: tool({
      description:
        "Navigate to the batch readings page to record a fermentation reading (gravity, pH, temperature, etc.). Opens the reading form automatically.",
      inputSchema: z.object({
        batchId: z.string().uuid().optional().describe("The batch UUID"),
        batchNumber: z
          .string()
          .optional()
          .describe("The batch number to search for"),
      }),
      execute: async ({ batchId, batchNumber }) => {
        const batch = await resolveBatch(supabase, batchId, batchNumber);

        const activeStates = ["fermenting", "conditioning", "packaging"];
        if (!activeStates.includes(batch.status)) {
          throw new Error(
            `Batch #${batch.batch_number} is "${batch.status}" — readings can only be added to batches that are fermenting, conditioning, or packaging.`
          );
        }

        return {
          action: "navigate" as const,
          url: `/production/batches/${batch.id}/readings`,
          prefillData: { autoShowForm: true },
          description: `Add a reading to batch #${batch.batch_number}`,
        };
      },
    }),

    createPackagingSession: tool({
      description:
        "Prepare a new packaging session. Returns a navigation action that opens the packaging session form with pre-filled data. The user will review and submit the form.",
      inputSchema: z.object({
        sessionDate: z
          .string()
          .describe("Session date (YYYY-MM-DD)"),
        notes: z
          .string()
          .optional()
          .describe("Optional session notes or special instructions"),
      }),
      execute: async ({ sessionDate, notes }) => {
        const prefillData: Record<string, unknown> = {
          session_date: sessionDate,
        };
        if (notes) prefillData.notes = notes;

        return {
          action: "navigate" as const,
          url: "/production/packaging/new",
          prefillData,
          description: `Create a packaging session for ${sessionDate}`,
        };
      },
    }),
  };
}
