/**
 * Recipe Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `recipeEntity` from `@/entities/recipe` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { recipeCore } from "./core";
import { recipePresentation } from "./presentation";

export const recipeEntity = createEntityConfig(recipeCore, recipePresentation);

// Re-export the server-safe core surface: recipeCore, recipeSchema,
// recipeStateMachine, statusOptions, Recipe, RecipeFormValues.
export * from "./core";
