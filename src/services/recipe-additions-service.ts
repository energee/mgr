/**
 * One client command for category-scoped recipe-additions replacement.
 * Transaction, scope validation, and optimistic locking live in Postgres.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/supabase";

export type RecipeAdditionScope = "water_chemistry" | "other";

export type RecipeAdditionReplacementItem = {
  id?: string;
  additive_id: string;
  amount: number;
  unit: string;
  timing: string;
  target?: string | null;
};

export type ReplaceRecipeAdditionsInput = {
  recipeId: string;
  expectedVersion: number;
  scope: RecipeAdditionScope;
  /** `null` omits the scope; an empty array explicitly clears it. */
  items: readonly RecipeAdditionReplacementItem[] | null;
};

export type ReplaceRecipeAdditionsResult = {
  version: number;
};

export async function replaceRecipeAdditions(
  supabase: SupabaseClient<Database>,
  input: ReplaceRecipeAdditionsInput,
): Promise<ReplaceRecipeAdditionsResult> {
  const { data, error } = await supabase.rpc("replace_recipe_additions_atomic", {
    p_recipe_id: input.recipeId,
    p_expected_version: input.expectedVersion,
    p_scope: input.scope,
    p_items: input.items as Json,
  });

  if (error) {
    throw Object.assign(new Error(error.message), error);
  }

  const result = data as ReplaceRecipeAdditionsResult | null;
  if (typeof result?.version !== "number") {
    throw new Error("Atomic recipe additions replacement returned no committed version");
  }
  return result;
}
