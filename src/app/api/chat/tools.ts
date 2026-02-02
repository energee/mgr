import { tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Escape LIKE/ILIKE wildcard characters so they match literally. */
function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

/**
 * Create chat tools bound to an authenticated Supabase client.
 * All tools are read-only — the assistant cannot modify data.
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
          .select("*, style:beer_styles(id, name, category)")
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
          all: data,
          available,
          inUse,
          summary: {
            total: data?.length || 0,
            available: available?.length || 0,
            inUse: inUse?.length || 0,
          },
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
        "Get raw ingredient inventory levels with lot quantities and expiration dates. Optionally filter by category (malt, hop, yeast, adjunct, chemical).",
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
          ...item,
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
          .select("*")
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
  };
}
