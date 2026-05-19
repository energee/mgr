/**
 * Finished Good Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `finishedGoodEntity` from `@/entities/finished-good` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { finishedGoodCore } from "./core";
import { finishedGoodPresentation } from "./presentation";

export const finishedGoodEntity = createEntityConfig(
  finishedGoodCore,
  finishedGoodPresentation,
);

// Re-export the server-safe core surface: finishedGoodCore, finishedGoodSchema,
// FinishedGoodView, FinishedGoodFormValues.
export * from "./core";
