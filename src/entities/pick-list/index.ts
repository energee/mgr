/**
 * Pick List Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `pickListEntity` from `@/entities/pick-list` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { pickListCore } from "./core";
import { pickListPresentation } from "./presentation";

export const pickListEntity = createEntityConfig(
  pickListCore,
  pickListPresentation,
);

// Re-export the server-safe core surface: pickListCore, pickListSchema,
// PickListView, PickListFormValues, pickListStateMachine, statusOptions.
export * from "./core";
