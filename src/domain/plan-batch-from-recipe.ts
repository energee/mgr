/**
 * Plan Batch from Recipe
 *
 * Shared entry point for planning a new batch from a recipe. Derives the
 * batch name ("{brand} - {recipe}", matching CreateBatchFromShortfall) and
 * volume from the recipe's batch_size_bbl, stashes them in the prefill
 * store, and returns the batch create route — the same prefill mechanism
 * the AI chat panel uses and /production/batches/new already consumes.
 *
 * Callers:
 * - recipe list rows: "Plan Batch" entity action (src/entities/recipe.tsx)
 * - recipe detail: header button (recipe-editor-page.tsx)
 */

import { createClient } from "@/lib/supabase/client";
import { setPrefill } from "@/contexts/prefill-store";

/** Destination consumed by callers after the prefill is staged. */
export const NEW_BATCH_PATH = "/production/batches/new";

/** Minimal recipe shape needed to derive batch defaults. */
export type PlanBatchRecipe = {
  id: string;
  name: string;
  brand_id?: string | null;
  batch_size_bbl?: number | null;
};

/**
 * Stage recipe-derived batch defaults (recipe_id, name, volume_bbl) in the
 * prefill store and return the batch create route to navigate to.
 *
 * Fetches the brand name (when the recipe has a brand) so the batch name
 * follows the "{brand} - {recipe}" convention; falls back to the recipe
 * name alone if the brand lookup fails. The prefill store persists to
 * sessionStorage, so the staged values survive a full-page navigation
 * (needed by the entity-action caller, which has no client router).
 */
export async function preparePlanBatchPrefill(
  recipe: PlanBatchRecipe,
): Promise<string> {
  let batchName = recipe.name;
  if (recipe.brand_id) {
    const { data: brand } = await createClient()
      .from("brands")
      .select("name")
      .eq("id", recipe.brand_id)
      .maybeSingle();
    if (brand?.name) {
      batchName = `${brand.name} - ${recipe.name}`;
    }
  }

  setPrefill({
    recipe_id: recipe.id,
    name: batchName,
    ...(recipe.batch_size_bbl != null
      ? { volume_bbl: recipe.batch_size_bbl }
      : {}),
  });

  return NEW_BATCH_PATH;
}
