/**
 * Batch Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `batchEntity` from `@/entities/batch` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { batchCore } from "./core";
import { batchPresentation } from "./presentation";

export const batchEntity = createEntityConfig(batchCore, batchPresentation);

// Re-export the server-safe core surface: batchCore, batchSchema,
// batchStateMachine, statusOptions, Batch, BatchFormValues.
export * from "./core";
