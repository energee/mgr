/**
 * Recipe Domain Service
 *
 * Wraps recipe-specific RPC functions (style compliance analysis,
 * improvement suggestions, summaries) in the ServiceResult pattern.
 * Consolidates logic previously duplicated between AI chat tools
 * and the recipe-analyzer library.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import type {
  StyleComplianceResult,
  RecipeSuggestionsResult,
} from "@/lib/ai/recipe-analyzer";
import { type ServiceResult, ok, err, parseSupabaseError, dynamicRpc } from "./types";

/** Summary returned by the get_recipe_summary RPC function. */
export type RecipeSummary = {
  recipe_id: string;
  recipe_name: string;
  style_name: string | null;
  status: string;
  volume_bbl: number | null;
  est_og: number | null;
  est_fg: number | null;
  est_abv: number | null;
  est_ibu: number | null;
  est_srm: number | null;
  grain_bill: Array<{ name: string; weight_lbs: number; percentage: number }>;
  hop_schedule: Array<{ name: string; amount_oz: number; timing: string; use: string }>;
  yeasts: Array<{ name: string; attenuation: number }>;
}

export const recipeService = {
  /**
   * Analyze a recipe's compliance with its target beer style guidelines.
   * Wraps the `analyze_recipe_style_compliance` RPC function.
   */
  async analyzeCompliance(
    supabase: SupabaseClient<Database>,
    recipeId: string
  ): Promise<ServiceResult<StyleComplianceResult>> {
    try {
      const { data, error } = await dynamicRpc(supabase,
        "analyze_recipe_style_compliance",
        { p_recipe_id: recipeId }
      );

      if (error) {
        return err(parseSupabaseError(error, { table: "recipes", id: recipeId }));
      }

      return ok(data as StyleComplianceResult);
    } catch (e) {
      return err({
        code: "UNKNOWN",
        message: `Failed to analyze recipe compliance: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      });
    }
  },

  /**
   * Get a comprehensive recipe summary including grain bill, hop schedule, and yeasts.
   * Wraps the `get_recipe_summary` RPC function.
   */
  async getSummary(
    supabase: SupabaseClient<Database>,
    recipeId: string
  ): Promise<ServiceResult<RecipeSummary>> {
    try {
      const { data, error } = await dynamicRpc(supabase,
        "get_recipe_summary",
        { p_recipe_id: recipeId }
      );

      if (error) {
        return err(parseSupabaseError(error, { table: "recipes", id: recipeId }));
      }

      return ok(data as RecipeSummary);
    } catch (e) {
      return err({
        code: "UNKNOWN",
        message: `Failed to get recipe summary: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      });
    }
  },

  /**
   * Get AI-generated suggestions for improving a recipe.
   * Wraps the `suggest_recipe_improvements` RPC function.
   */
  async suggestImprovements(
    supabase: SupabaseClient<Database>,
    recipeId: string
  ): Promise<ServiceResult<RecipeSuggestionsResult>> {
    try {
      const { data, error } = await dynamicRpc(supabase,
        "suggest_recipe_improvements",
        { p_recipe_id: recipeId }
      );

      if (error) {
        return err(parseSupabaseError(error, { table: "recipes", id: recipeId }));
      }

      return ok(data as RecipeSuggestionsResult);
    } catch (e) {
      return err({
        code: "UNKNOWN",
        message: `Failed to get recipe suggestions: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      });
    }
  },
};
