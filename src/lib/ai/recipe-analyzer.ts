/**
 * Recipe Analysis Utilities
 *
 * Wrappers around database RPC functions for recipe style compliance
 * analysis and improvement suggestions.
 */

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

// Cached lazy import to avoid pulling in browser-only createBrowserClient
// when this module is imported server-side (e.g. for type re-exports).
let clientImport: Promise<typeof import("@/lib/supabase/client")> | null = null;
function getClientModule() {
  if (!clientImport) clientImport = import("@/lib/supabase/client");
  return clientImport;
}

/**
 * Analyze a recipe's compliance with its target style guidelines
 */
export async function analyzeStyleCompliance(
  recipeId: string
): Promise<StyleComplianceResult> {
  const { createClient } = await getClientModule();
  const supabase = createClient();
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
  recipeId: string
): Promise<RecipeSuggestionsResult> {
  const { createClient } = await getClientModule();
  const supabase = createClient();
  const { data, error } = await supabase.rpc("suggest_recipe_improvements", {
    p_recipe_id: recipeId,
  });

  if (error) {
    throw new Error(`Failed to get suggestions: ${error.message}`);
  }

  return data as unknown as RecipeSuggestionsResult;
}
