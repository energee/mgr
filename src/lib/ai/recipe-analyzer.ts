/**
 * Recipe Analysis Utilities
 *
 * Wrappers around database RPC functions for recipe style compliance
 * analysis and improvement suggestions.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

// Types
export interface StyleComplianceResult {
  recipe_id: string;
  recipe_name: string;
  style_name: string;
  style_category: string;
  analysis: {
    og: ParameterAnalysis;
    fg: ParameterAnalysis;
    abv: ParameterAnalysis;
    ibu: ParameterAnalysis;
    srm: ParameterAnalysis;
  };
  overall_compliance: boolean;
}

export interface ParameterAnalysis {
  value: number | null;
  min: number | null;
  max: number | null;
  status: "in_range" | "below_range" | "above_range" | "unknown";
}

export interface RecipeSuggestion {
  category: string;
  severity: "info" | "warning" | "error";
  message: string;
  parameter: string;
}

export interface RecipeSuggestionsResult {
  recipe_id: string;
  recipe_name: string;
  suggestion_count: number;
  suggestions: RecipeSuggestion[];
}

/**
 * Analyze a recipe's compliance with its target style guidelines
 */
export async function analyzeStyleCompliance(
  supabase: SupabaseClient<Database>,
  recipeId: string
): Promise<StyleComplianceResult> {
  const { data, error } = await supabase.rpc("analyze_recipe_style_compliance", {
    p_recipe_id: recipeId,
  });

  if (error) {
    throw new Error(`Failed to analyze recipe: ${error.message}`);
  }

  return data as unknown as StyleComplianceResult;
}

/**
 * Get AI-generated suggestions for improving a recipe
 */
export async function getRecipeSuggestions(
  supabase: SupabaseClient<Database>,
  recipeId: string
): Promise<RecipeSuggestionsResult> {
  const { data, error } = await supabase.rpc("suggest_recipe_improvements", {
    p_recipe_id: recipeId,
  });

  if (error) {
    throw new Error(`Failed to get suggestions: ${error.message}`);
  }

  return data as unknown as RecipeSuggestionsResult;
}
