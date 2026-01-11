/**
 * Query Helpers for AI Integration
 *
 * Pre-built query functions for common AI tasks.
 */

import { createClient } from "@/lib/supabase/client";
import { batchEntity } from "@/entities/batch";

// Create client once at module level (createClient returns singleton)
const supabase = createClient();

/**
 * Helper functions for AI to query the MGR system
 */
export const AIQueryHelpers = {
  /**
   * Search recipes by name or style
   */
  async searchRecipes(
    query: string,
    options?: { limit?: number; includeEstimates?: boolean }
  ) {
    const limit = options?.limit || 10;

    const table = options?.includeEstimates
      ? "recipes_with_estimates"
      : "recipes";

    const { data, error } = await supabase
      .from(table)
      .select(
        `
        *,
        style:beer_styles(id, name, category)
      `
      )
      .or(`name.ilike.%${query}%`)
      .limit(limit);

    if (error) throw error;
    return data;
  },

  /**
   * Find recipes using a specific ingredient
   */
  async findRecipesWithIngredient(
    ingredientType: "malt" | "hop" | "yeast",
    ingredientId: string
  ) {

    if (ingredientType === "yeast") {
      const { data, error } = await supabase
        .from("recipes")
        .select("id, name, yeast:yeasts(name)")
        .eq("yeast_id", ingredientId);
      if (error) throw error;
      return data;
    }

    const junctionTable =
      ingredientType === "malt" ? "recipe_malts" : "recipe_hops";
    const foreignKey = ingredientType === "malt" ? "malt_id" : "hop_id";

    const { data, error } = await supabase
      .from(junctionTable)
      .select(
        `
        recipe:recipes(id, name)
      `
      )
      .eq(foreignKey, ingredientId);

    if (error) throw error;
    return data?.map((r) => r.recipe) || [];
  },

  /**
   * Get current batch status summary
   */
  async getBatchStatusSummary() {

    const { data, error } = await supabase
      .from("batches")
      .select("status")
      .neq("status", "cancelled");

    if (error) throw error;

    const summary: Record<string, number> = {};
    for (const batch of data || []) {
      summary[batch.status] = (summary[batch.status] || 0) + 1;
    }
    return summary;
  },

  /**
   * Get batches ready for next step
   */
  async getBatchesReadyForTransition() {

    const { data: batches, error } = await supabase
      .from("batches")
      .select(
        `
        id,
        batch_number,
        status,
        recipe:recipes(name),
        planned_start_date
      `
      )
      .in("status", ["planned", "fermenting", "conditioning", "packaging"]);

    if (error) throw error;

    // For each batch, determine if it might be ready for next step
    return batches?.map((batch) => ({
      ...batch,
      possibleTransitions: getNextStates(batch.status),
    }));
  },

  /**
   * Get vessel availability
   */
  async getVesselAvailability() {

    const { data, error } = await supabase
      .from("vessels_with_current_batch")
      .select(
        `
        id,
        name,
        vessel_type,
        capacity_bbl,
        status,
        current_batch_id,
        current_batch_number
      `
      )
      .eq("is_active", true)
      .order("name");

    if (error) throw error;

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

  /**
   * Get inventory levels for a specific brand
   */
  async getBrandInventory(brandId: string) {

    const { data, error } = await supabase
      .from("bin_inventory")
      .select(
        `
        quantity,
        bin:bins(name, bin_type),
        finished_good:finished_goods(
          id,
          batch_number,
          package_type:package_types(name, volume_oz)
        )
      `
      )
      .eq("finished_goods.brand_id", brandId);

    if (error) throw error;
    return data;
  },

  /**
   * Get orders pending fulfillment
   */
  async getPendingOrders(options?: { customerId?: string; limit?: number }) {

    let query = supabase
      .from("orders")
      .select(
        `
        id,
        order_number,
        status,
        order_date,
        requested_date,
        customer:customers(id, name)
      `
      )
      .in("status", ["confirmed", "scheduled", "picking"])
      .order("requested_date");

    if (options?.customerId) {
      query = query.eq("customer_id", options.customerId);
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  /**
   * Get recent brew logs
   */
  async getRecentBrewLogs(limit = 10) {

    const { data, error } = await supabase
      .from("brew_logs")
      .select(
        `
        id,
        brew_number,
        brew_date,
        status,
        recipe:recipes(name)
      `
      )
      .order("brew_date", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data;
  },

  /**
   * Get style guidelines
   */
  async getStyleGuidelines(styleId: string) {

    const { data, error } = await supabase
      .from("beer_styles")
      .select("*")
      .eq("id", styleId)
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Compare recipe estimates to style
   */
  async compareRecipeToStyle(recipeId: string) {

    const { data, error } = await supabase.rpc(
      "analyze_recipe_style_compliance",
      { p_recipe_id: recipeId }
    );

    if (error) throw error;
    return data;
  },

  /**
   * Get yeast inventory and viability
   */
  async getYeastInventory() {

    const { data, error } = await supabase
      .from("yeast_brinks_with_status")
      .select(
        `
        id,
        brink_identifier,
        strain:yeasts(name),
        status,
        current_weight_lbs,
        estimated_viability,
        generation
      `
      )
      .eq("status", "active")
      .order("brink_identifier");

    if (error) throw error;
    return data;
  },

  /**
   * Get ingredient inventory levels
   */
  async getIngredientInventory(ingredientType?: string) {

    let query = supabase.from("inventory_items").select(
      `
        id,
        name,
        catalog_type,
        unit,
        reorder_point,
        lots:inventory_lots(
          quantity,
          expiration_date
        )
      `
    );

    if (ingredientType) {
      query = query.eq("catalog_type", ingredientType);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Calculate available quantities
    return data?.map((item) => ({
      ...item,
      total_quantity: item.lots?.reduce(
        (sum: number, lot: { quantity: number }) => sum + lot.quantity,
        0
      ) || 0,
      earliest_expiration: item.lots?.reduce(
        (earliest: string | null, lot: { expiration_date: string | null }) => {
          if (!lot.expiration_date) return earliest;
          if (!earliest) return lot.expiration_date;
          return lot.expiration_date < earliest
            ? lot.expiration_date
            : earliest;
        },
        null
      ),
    }));
  },

  /**
   * Get production schedule for date range
   */
  async getProductionSchedule(startDate: string, endDate: string) {

    const { data, error } = await supabase
      .from("batches")
      .select(
        `
        id,
        batch_number,
        status,
        planned_start_date,
        recipe:recipes(
          name,
          volume_bbl,
          fermentation_days,
          conditioning_days
        )
      `
      )
      .gte("planned_start_date", startDate)
      .lte("planned_start_date", endDate)
      .neq("status", "cancelled")
      .order("planned_start_date");

    if (error) throw error;
    return data;
  },
};

/**
 * Helper to get next possible states for a batch
 * Uses the batch entity's state machine as the single source of truth
 */
function getNextStates(currentState: string): string[] {
  return batchEntity.stateMachine?.transitions[currentState] || [];
}
