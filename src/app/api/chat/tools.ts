import { tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatStateLabel } from "@/types/entity";
import { getHelpContentForSystemPrompt } from "@/lib/help-content";

/** Escape LIKE/ILIKE wildcard characters so they match literally. */
function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

/** Execute an RPC call and throw on error. */
async function rpc<T>(
  supabase: SupabaseClient,
  fn: string,
  params: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(fn, params);
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
    // Query Tools (direct Supabase queries)
    // =========================================================================

    searchRecipes: tool({
      description: "Search recipes by name. Returns recipe details with style info.",
      inputSchema: z.object({
        query: z.string().describe("Search term to match against recipe names"),
        limit: z.number().optional().default(10).describe("Max results to return"),
      }),
      execute: async ({ query: searchQuery, limit }) =>
        query(
          supabase
            .from("recipes_with_estimates")
            .select("id, name, status, volume_bbl, est_og, est_fg, est_abv, est_ibu, est_srm, style:beer_styles(id, name, category)")
            .ilike("name", `%${escapeLike(searchQuery)}%`)
            .limit(limit),
        ),
    }),

    getBatchStatus: tool({
      description:
        "Get a summary of all batches grouped by status (planned, fermenting, conditioning, etc.). Useful for production overview.",
      inputSchema: z.object({}),
      execute: async () => {
        const data = await query<{ status: string }[]>(
          supabase.from("batches").select("status").neq("status", "cancelled"),
        );
        const summary: Record<string, number> = {};
        for (const { status } of data) {
          summary[status] = (summary[status] || 0) + 1;
        }
        return summary;
      },
    }),

    getVesselAvailability: tool({
      description:
        "Get vessel utilization: which vessels are available, which are in use, and their current batch assignments.",
      inputSchema: z.object({}),
      execute: async () => {
        const data = await query<{ id: string; name: string; vessel_type: string; capacity_bbl: number; status: string; current_batch_id: string | null; batch_number: string | null }[]>(
          supabase
            .from("vessels_with_batch")
            .select("id, name, vessel_type, capacity_bbl, status, current_batch_id, batch_number")
            .eq("is_active", true)
            .order("name"),
        );
        const available = data.filter(
          (v) => v.status === "ready_for_use" && !v.current_batch_id
        );
        const inUse = data.filter((v) => v.current_batch_id);
        return {
          summary: {
            total: data.length,
            available: available.length,
            inUse: inUse.length,
          },
          available: available.map((v) => ({ id: v.id, name: v.name, type: v.vessel_type, capacity_bbl: v.capacity_bbl })),
          inUse: inUse.map((v) => ({ id: v.id, name: v.name, type: v.vessel_type, capacity_bbl: v.capacity_bbl, batch_number: v.batch_number })),
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
            .select("id, batch_number, status, planned_start_date, recipe:recipes(name, volume_bbl, fermentation_days, conditioning_days)")
            .gte("planned_start_date", startDate)
            .lte("planned_start_date", endDate)
            .neq("status", "cancelled")
            .order("planned_start_date"),
        ),
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
        let q = supabase.from("inventory_items").select(
          "id, name, category, unit, reorder_point, inventory_lots(quantity, expiration_date)"
        );
        if (category) q = q.eq("category", category);

        const { data, error } = await q;
        if (error) throw new Error(error.message);

        interface ItemRow {
          id: string;
          name: string;
          category: string;
          unit: string;
          reorder_point: number | null;
          inventory_lots: { quantity: number; expiration_date: string | null }[];
        }

        return (data as ItemRow[])?.map((item) => {
          const lots = item.inventory_lots || [];
          const expirationDates = lots
            .map((lot) => lot.expiration_date)
            .filter((d): d is string => d !== null);

          return {
            id: item.id,
            name: item.name,
            category: item.category,
            unit: item.unit,
            reorder_point: item.reorder_point,
            total_quantity: lots.reduce((sum, lot) => sum + lot.quantity, 0),
            earliest_expiration: expirationDates.length > 0
              ? expirationDates.sort()[0]
              : null,
            lot_count: lots.length,
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
            .select("id, cleaning_type, from_status, to_status, duration_min, chemicals_used, notes, created_at")
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
            .select("id, from_vessel:vessels!vessel_transfers_from_vessel_id_fkey(name), to_vessel:vessels!vessel_transfers_to_vessel_id_fkey(name), volume_bbl, transfer_type, notes, transferred_at")
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
            .select("id, name, volume_bbl, malt_cost, hop_cost, yeast_cost, adjunct_cost, total_cogs, cogs_per_bbl")
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
        let q = supabase
          .from("batches_with_brew_info")
          .select(
            "id, batch_number, name, status, volume_bbl, planned_start_date, actual_og, actual_fg, actual_abv, brew_date, current_vessel_name, notes, recipe:recipes(id, name)"
          );
        if (batchId) {
          q = q.eq("id", batchId);
        } else if (batchNumber) {
          q = q.ilike("batch_number", `%${escapeLike(batchNumber)}%`);
        } else {
          throw new Error("Either batchId or batchNumber is required");
        }
        const { data, error } = batchId
          ? await q.single()
          : await q.limit(5);
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
        const recipeJoin = recipeName
          ? "recipe:recipes!inner(id, name)"
          : "recipe:recipes(id, name)";
        let q = supabase
          .from("batches_with_brew_info")
          .select(
            `id, batch_number, name, status, volume_bbl, planned_start_date, brew_date, current_vessel_name, ${recipeJoin}`
          )
          .order("planned_start_date", { ascending: false })
          .limit(limit);

        if (status) q = q.eq("status", status);
        if (batchNumber)
          q = q.ilike("batch_number", `%${escapeLike(batchNumber)}%`);
        if (startDate) q = q.gte("planned_start_date", startDate);
        if (endDate) q = q.lte("planned_start_date", endDate);
        if (recipeName)
          q = q.ilike("recipes.name", `%${escapeLike(recipeName)}%`);

        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    getBrands: tool({
      description: "Search brands by name. Returns brand info with style.",
      inputSchema: z.object({
        query: z.string().optional().describe("Search by brand name"),
        limit: z.number().optional().default(20).describe("Max results"),
      }),
      execute: async ({ query: searchQuery, limit }) => {
        let q = supabase
          .from("brands")
          .select("id, name, variant, abv, description, style:beer_styles(id, name)")
          .order("name")
          .limit(limit);

        if (searchQuery) q = q.ilike("name", `%${escapeLike(searchQuery)}%`);

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
      execute: async ({ brandId, query: searchQuery, limit }) => {
        let q = supabase
          .from("finished_goods_with_availability")
          .select(
            "id, lot_number, brand_name, package_type_name, total_quantity, allocated_quantity, reserved_quantity, available_quantity, production_date, best_by_date"
          )
          .gt("available_quantity", 0)
          .order("brand_name")
          .limit(limit);

        if (brandId) q = q.eq("brand_id", brandId);
        if (searchQuery) q = q.ilike("brand_name", `%${escapeLike(searchQuery)}%`);

        const { data, error } = await q;
        if (error) throw new Error(error.message);
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
      execute: async ({ query: searchQuery, entityType }) => {
        type Result = { type: string; id: string; display: string };
        const escaped = escapeLike(searchQuery);
        const should = (t: string) => !entityType || entityType === t;

        const queries: PromiseLike<Result[]>[] = [];

        if (should("batch")) {
          const batchSelect = "id, batch_number, name" as const;
          const toResult = (b: { id: string; batch_number: string; name: string | null }) => ({
            type: "batch" as const,
            id: b.id,
            display: `${b.batch_number}${b.name ? ` — ${b.name}` : ""}`,
          });
          queries.push(
            Promise.all([
              supabase
                .from("batches")
                .select(batchSelect)
                .ilike("batch_number", `%${escaped}%`)
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
        const customerJoin = customerName
          ? "customer:customers!inner(id, name)"
          : "customer:customers(id, name)";
        let q = supabase
          .from("orders")
          .select(
            `id, order_number, status, order_date, requested_date, scheduled_date, notes, ${customerJoin}`
          )
          .order("order_date", { ascending: false })
          .limit(limit);

        if (status) q = q.eq("status", status);
        if (startDate) q = q.gte("order_date", startDate);
        if (endDate) q = q.lte("order_date", endDate);
        if (customerName)
          q = q.ilike("customers.name", `%${escapeLike(customerName)}%`);

        const { data, error } = await q;
        if (error) throw new Error(error.message);
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
      execute: async ({ query: searchQuery, limit }) => {
        let q = supabase
          .from("customers_with_order_summary")
          .select(
            "id, name, customer_type, contact_name, email, phone, total_orders, total_revenue, pending_orders, last_order_date"
          )
          .eq("is_active", true)
          .order("name")
          .limit(limit);

        if (searchQuery) q = q.ilike("name", `%${escapeLike(searchQuery)}%`);

        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    searchBrewLogs: tool({
      description:
        "Search brew logs (hot-side brew day records) by status, date range, or brew number. Returns brew log headers with recipe info.",
      inputSchema: z.object({
        status: z
          .string()
          .optional()
          .describe("Filter by status: draft, in_progress, completed, cancelled"),
        startDate: z
          .string()
          .optional()
          .describe("Brew date start (YYYY-MM-DD)"),
        endDate: z
          .string()
          .optional()
          .describe("Brew date end (YYYY-MM-DD)"),
        brewNumber: z
          .string()
          .optional()
          .describe("Filter by brew number (partial match)"),
        limit: z.number().optional().default(20).describe("Max results"),
      }),
      execute: async ({ status, startDate, endDate, brewNumber, limit }) => {
        let q = supabase
          .from("brew_logs")
          .select(
            "id, brew_number, brew_date, status, notes, recipe:recipes(id, name)"
          )
          .order("brew_date", { ascending: false })
          .limit(limit);

        if (status) q = q.eq("status", status);
        if (brewNumber)
          q = q.ilike("brew_number", `%${escapeLike(brewNumber)}%`);
        if (startDate) q = q.gte("brew_date", startDate);
        if (endDate) q = q.lte("brew_date", endDate);

        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    searchPurchaseOrders: tool({
      description:
        "Search purchase orders by status, date range, or supplier name. Returns PO headers with supplier info.",
      inputSchema: z.object({
        status: z
          .string()
          .optional()
          .describe(
            "Filter by status: draft, submitted, confirmed, partial, fulfilled, cancelled"
          ),
        startDate: z
          .string()
          .optional()
          .describe("Order date start (YYYY-MM-DD)"),
        endDate: z
          .string()
          .optional()
          .describe("Order date end (YYYY-MM-DD)"),
        supplierName: z
          .string()
          .optional()
          .describe("Filter by supplier name (partial match)"),
        limit: z.number().optional().default(20).describe("Max results"),
      }),
      execute: async ({ status, startDate, endDate, supplierName, limit }) => {
        const supplierJoin = supplierName
          ? "supplier:suppliers!inner(id, name)"
          : "supplier:suppliers(id, name)";
        let q = supabase
          .from("purchase_orders")
          .select(
            `id, po_number, status, order_date, expected_date, shipping_cost, tax, notes, ${supplierJoin}`
          )
          .order("order_date", { ascending: false })
          .limit(limit);

        if (status) q = q.eq("status", status);
        if (startDate) q = q.gte("order_date", startDate);
        if (endDate) q = q.lte("order_date", endDate);
        if (supplierName)
          q = q.ilike("suppliers.name", `%${escapeLike(supplierName)}%`);

        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    searchSuppliers: tool({
      description:
        "Search suppliers by name. Returns supplier contact info, payment terms, and lead times.",
      inputSchema: z.object({
        query: z.string().optional().describe("Search by supplier name"),
        isActive: z
          .boolean()
          .optional()
          .default(true)
          .describe("Filter by active status (default true)"),
        limit: z.number().optional().default(20).describe("Max results"),
      }),
      execute: async ({ query: searchQuery, isActive, limit }) => {
        let q = supabase
          .from("suppliers")
          .select(
            "id, name, contact_name, contact_email, contact_phone, payment_terms, default_lead_time_days, is_active"
          )
          .order("name")
          .limit(limit);

        if (isActive !== undefined) q = q.eq("is_active", isActive);
        if (searchQuery) q = q.ilike("name", `%${escapeLike(searchQuery)}%`);

        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    searchPickLists: tool({
      description:
        "Search pick lists by status, date range, or customer name. Returns pick list details with order info and progress.",
      inputSchema: z.object({
        status: z
          .string()
          .optional()
          .describe("Filter by status: pending, in_progress, completed, cancelled"),
        startDate: z
          .string()
          .optional()
          .describe("Generated-at date start (YYYY-MM-DD)"),
        endDate: z
          .string()
          .optional()
          .describe("Generated-at date end (YYYY-MM-DD)"),
        customerName: z
          .string()
          .optional()
          .describe("Filter by customer name (partial match)"),
        limit: z.number().optional().default(20).describe("Max results"),
      }),
      execute: async ({ status, startDate, endDate, customerName, limit }) => {
        let q = supabase
          .from("pick_list_details")
          .select(
            "id, status, generated_at, order_id, order_number, customer_name, total_items, items_picked, assigned_to_name"
          )
          .order("generated_at", { ascending: false })
          .limit(limit);

        if (status) q = q.eq("status", status);
        if (startDate) q = q.gte("generated_at", startDate);
        if (endDate) q = q.lte("generated_at", endDate);
        if (customerName)
          q = q.ilike("customer_name", `%${escapeLike(customerName)}%`);

        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    searchYeastPitches: tool({
      description:
        "Search yeast pitches with viability and strain details. Filter by status or strain name.",
      inputSchema: z.object({
        status: z
          .string()
          .optional()
          .describe("Filter by status: available, pitched, harvested, expired, discarded"),
        strainName: z
          .string()
          .optional()
          .describe("Filter by yeast strain name (partial match)"),
        limit: z.number().optional().default(20).describe("Max results"),
      }),
      execute: async ({ status, strainName, limit }) => {
        let q = supabase
          .from("yeast_pitches_with_details")
          .select(
            "id, status, source_type, generation, initial_viability, estimated_viability, viability_status, days_old, strain_name, strain_code, strain_manufacturer, batch_number, location_name"
          )
          .order("created_at", { ascending: false })
          .limit(limit);

        if (status) q = q.eq("status", status);
        if (strainName)
          q = q.ilike("strain_name", `%${escapeLike(strainName)}%`);

        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    getKegInventory: tool({
      description:
        "Get keg inventory with type, owner, location, and contents. Filter by state (empty/filled/shipped), keg type, or location.",
      inputSchema: z.object({
        state: z
          .string()
          .optional()
          .describe("Filter by keg state: empty, filled, shipped, returned, lost, retired"),
        kegTypeName: z
          .string()
          .optional()
          .describe("Filter by keg type name (partial match)"),
        locationName: z
          .string()
          .optional()
          .describe("Filter by location name (partial match)"),
        limit: z.number().optional().default(50).describe("Max results"),
      }),
      execute: async ({ state, kegTypeName, locationName, limit }) => {
        let q = supabase
          .from("keg_inventory_with_details")
          .select(
            "id, keg_type_name, keg_type_code, volume_bbl, keg_owner_name, state, location_name, quantity, batch_number, finished_good_name"
          )
          .order("keg_type_name")
          .limit(limit);

        if (state) q = q.eq("state", state);
        if (kegTypeName)
          q = q.ilike("keg_type_name", `%${escapeLike(kegTypeName)}%`);
        if (locationName)
          q = q.ilike("location_name", `%${escapeLike(locationName)}%`);

        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    searchDeliveries: tool({
      description:
        "Search deliveries by status or date range. Returns delivery info with transfer and order counts.",
      inputSchema: z.object({
        status: z
          .string()
          .optional()
          .describe("Filter by status: planned, in_transit, delivered, cancelled"),
        startDate: z
          .string()
          .optional()
          .describe("Scheduled date start (YYYY-MM-DD)"),
        endDate: z
          .string()
          .optional()
          .describe("Scheduled date end (YYYY-MM-DD)"),
        limit: z.number().optional().default(20).describe("Max results"),
      }),
      execute: async ({ status, startDate, endDate, limit }) => {
        let q = supabase
          .from("deliveries_with_summary")
          .select(
            "id, delivery_number, status, scheduled_date, driver_name, vehicle, notes, transfer_count, order_count, total_stops"
          )
          .order("scheduled_date", { ascending: false })
          .limit(limit);

        if (status) q = q.eq("status", status);
        if (startDate) q = q.gte("scheduled_date", startDate);
        if (endDate) q = q.lte("scheduled_date", endDate);

        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    searchLocationTransfers: tool({
      description:
        "Search location transfers (inventory movements between locations/bins). Filter by status or date range.",
      inputSchema: z.object({
        status: z
          .string()
          .optional()
          .describe("Filter by status: draft, shipped, received, cancelled"),
        startDate: z
          .string()
          .optional()
          .describe("Ship date start (YYYY-MM-DD)"),
        endDate: z
          .string()
          .optional()
          .describe("Ship date end (YYYY-MM-DD)"),
        limit: z.number().optional().default(20).describe("Max results"),
      }),
      execute: async ({ status, startDate, endDate, limit }) => {
        let q = supabase
          .from("location_transfers_with_details")
          .select(
            "id, status, ship_date, receive_date, from_bin_name, to_bin_name, from_location_name, to_location_name, delivery_number, lines_count"
          )
          .order("ship_date", { ascending: false })
          .limit(limit);

        if (status) q = q.eq("status", status);
        if (startDate) q = q.gte("ship_date", startDate);
        if (endDate) q = q.lte("ship_date", endDate);

        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    searchAllocations: tool({
      description:
        "Search inventory allocations (movements between sources and destinations). Filter by status, source/destination type, or date range.",
      inputSchema: z.object({
        status: z
          .string()
          .optional()
          .describe(
            "Filter by status: planned, pending_approval, completed, rejected, cancelled"
          ),
        sourceType: z
          .string()
          .optional()
          .describe("Filter by source type: inventory_lot, batch, finished_good, external"),
        destinationType: z
          .string()
          .optional()
          .describe(
            "Filter by destination type: batch, finished_good, order, taproom_sale, sample, adjustment, destruction, loss, transfer"
          ),
        startDate: z
          .string()
          .optional()
          .describe("Created-at date start (YYYY-MM-DD)"),
        endDate: z
          .string()
          .optional()
          .describe("Created-at date end (YYYY-MM-DD)"),
        limit: z.number().optional().default(20).describe("Max results"),
      }),
      execute: async ({ status, sourceType, destinationType, startDate, endDate, limit }) => {
        let q = supabase
          .from("allocations")
          .select(
            "id, source_type, source_id, destination_type, destination_id, quantity, volume_bbl, unit_cost, status, reason_code, lot_number, created_at"
          )
          .order("created_at", { ascending: false })
          .limit(limit);

        if (status) q = q.eq("status", status);
        if (sourceType) q = q.eq("source_type", sourceType);
        if (destinationType) q = q.eq("destination_type", destinationType);
        if (startDate) q = q.gte("created_at", startDate);
        if (endDate) q = q.lte("created_at", endDate);

        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    searchPackagingSessions: tool({
      description:
        "Search packaging sessions by status, date range, or brand. Returns session details with line item summary (brands, planned/actual counts).",
      inputSchema: z.object({
        status: z
          .string()
          .optional()
          .describe(
            "Filter by status: planned, in_progress, completed, revised, cancelled"
          ),
        startDate: z
          .string()
          .optional()
          .describe("Session date start (YYYY-MM-DD)"),
        endDate: z
          .string()
          .optional()
          .describe("Session date end (YYYY-MM-DD)"),
        brandName: z
          .string()
          .optional()
          .describe("Filter by brand name (partial match)"),
        limit: z.number().optional().default(20).describe("Max results"),
      }),
      execute: async ({ status, startDate, endDate, brandName, limit }) => {
        let q = supabase
          .from("packaging_sessions_with_summary")
          .select(
            "id, session_date, status, notes, line_count, brands, total_planned, total_actual"
          )
          .order("session_date", { ascending: false })
          .limit(limit);

        if (status) q = q.eq("status", status);
        if (startDate) q = q.gte("session_date", startDate);
        if (endDate) q = q.lte("session_date", endDate);
        if (brandName) q = q.ilike("brands", `%${escapeLike(brandName)}%`);

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

        const openDialog = dialogMap[toState];
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
