/**
 * Recipe Entity — server-safe core
 *
 * The pure-data half of the recipe entity: identity, the zod form schema,
 * state machine, relations, and AI metadata. No React imports — safe to
 * import from server route handlers and API routes.
 *
 * Recipes define the specifications for brewing — ingredients, process
 * parameters, and target measurements. Ingredients are stored in junction
 * tables (recipe_malts, recipe_hops, etc.) and calculated estimates
 * (OG, FG, ABV, IBU, SRM) come from the recipes_with_estimates view.
 */

import type { EntityCoreInput, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { recipeSchema } from "@/lib/schemas/recipe";

export { recipeSchema, type RecipeFormValues } from "@/lib/schemas/recipe";

// =============================================================================
// Types
// =============================================================================

/** Base table type extended with computed view fields for list/detail display */
type RecipeBase = Database["public"]["Tables"]["recipes"]["Row"];
type RecipeView = Database["public"]["Views"]["recipes_with_estimates"]["Row"];
export type Recipe = RecipeBase & Partial<Pick<RecipeView, "est_og" | "est_fg" | "est_abv" | "est_ibu" | "est_srm" | "style_name" | "est_cogs" | "batch_count">>;

// =============================================================================
// State Machine
// =============================================================================

export const recipeStateMachine: StateMachineConfig<Recipe> = {
  stateField: "status",
  states: ["draft", "spec", "complete"],
  initialState: "draft",
  transitions: {
    draft: ["spec", "complete"],
    spec: ["complete"],
    complete: [],
  },
  stateDisplay: {
    draft: { label: "Draft", color: "default" },
    spec: { label: "Spec", color: "warning" },
    complete: { label: "Complete", color: "success" },
  },
};

// Derive status options from state machine (single source of truth)
export const statusOptions = statesAsOptions(recipeStateMachine);

// =============================================================================
// Entity Core
// =============================================================================

export const recipeCore: EntityCoreInput<Recipe> = {
  name: "recipe",
  table: "recipes",
  displayName: "Recipe",
  domain: "production",

  viewTable: "recipes_with_estimates",

  // Explicit: sorted by most-recent recipe first.
  defaultSort: { column: "created_at", direction: "desc" },
  searchableFields: ["name", "brew_day_notes", "development_notes"],

  detailHeader: { title: "name" },

  formSchema: recipeSchema,

  stateMachine: recipeStateMachine,

  relations: [
    {
      name: "batches",
      entity: "batch",
      type: "hasMany",
      foreignKey: "recipe_id",
      showInDetail: true,
      detailTab: "Batches",
    },
  ],

  keyFields: ["name", "style_id", "volume_bbl", "mash_efficiency", "is_active", "status"],
};
