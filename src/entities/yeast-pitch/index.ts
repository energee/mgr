/**
 * Yeast Pitch Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `yeastPitchEntity` from `@/entities/yeast-pitch` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { yeastPitchCore } from "./core";
import { yeastPitchPresentation } from "./presentation";

export const yeastPitchEntity = createEntityConfig(
  yeastPitchCore,
  yeastPitchPresentation,
);

// Re-export the server-safe core surface: yeastPitchCore, yeastPitchSchema,
// yeastPitchStateMachine, statusOptions, SOURCE_TYPE_OPTIONS, STATUS_DISPLAY,
// VIABILITY_STATUS_DISPLAY, YeastPitch, YeastPitchFormValues.
export * from "./core";
