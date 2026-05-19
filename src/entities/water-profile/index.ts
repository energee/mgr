/**
 * Water Profile Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `waterProfileEntity` from `@/entities/water-profile` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { waterProfileCore } from "./core";
import { waterProfilePresentation } from "./presentation";

export const waterProfileEntity = createEntityConfig(
  waterProfileCore,
  waterProfilePresentation,
);

// Re-export the server-safe core surface: waterProfileCore, waterProfileSchema,
// WaterProfile, WaterProfileFormValues.
export * from "./core";
