/**
 * Allocation Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `allocationEntity` from `@/entities/allocation` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { allocationCore } from "./core";
import { allocationPresentation } from "./presentation";

export const allocationEntity = createEntityConfig(
  allocationCore,
  allocationPresentation,
);

// Re-export the server-safe core surface: allocationCore, allocationSchema,
// allocationStateMachine, statusOptions, SOURCE_TYPES, DESTINATION_TYPES,
// REASON_CODES, Allocation, AllocationFormValues.
export * from "./core";
