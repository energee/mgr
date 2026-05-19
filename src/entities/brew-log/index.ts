/**
 * Brew Log Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `brewLogEntity` from `@/entities/brew-log` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { brewLogCore } from "./core";
import { brewLogPresentation } from "./presentation";

export const brewLogEntity = createEntityConfig(
  brewLogCore,
  brewLogPresentation,
);

// Re-export the server-safe core surface: brewLogCore, brewLogSchema,
// BrewLog, BrewLogFormValues, BrewEvent, BrewMeasurement,
// brewLogStateMachine, statusOptions.
export * from "./core";
