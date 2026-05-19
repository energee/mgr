/**
 * Yeast Pitch Event Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `yeastPitchEventEntity` from `@/entities/yeast-pitch-event` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { yeastPitchEventCore } from "./core";
import { yeastPitchEventPresentation } from "./presentation";

export const yeastPitchEventEntity = createEntityConfig(
  yeastPitchEventCore,
  yeastPitchEventPresentation,
);

// Re-export the server-safe core surface: yeastPitchEventCore, yeastPitchEventSchema,
// YeastPitchEvent, YeastPitchEventFormValues.
export * from "./core";
