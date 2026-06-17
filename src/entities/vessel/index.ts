/**
 * Vessel Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `vesselEntity` from `@/entities/vessel` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { vesselCore } from "./core";
import { vesselPresentation } from "./presentation";

export const vesselEntity = createEntityConfig(vesselCore, vesselPresentation);

// Re-export the server-safe core surface: vesselCore, vesselSchema,
// vesselStateMachine, vesselTypeDisplayConfig, statusOptions, vesselTypeOptions,
// VESSEL_TYPES, VesselType, Vessel, VesselFormValues.
export * from "./core";
