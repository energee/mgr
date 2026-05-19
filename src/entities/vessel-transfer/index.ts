/**
 * Vessel Transfer Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `vesselTransferEntity` from `@/entities/vessel-transfer` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { vesselTransferCore } from "./core";
import { vesselTransferPresentation } from "./presentation";

export const vesselTransferEntity = createEntityConfig(
  vesselTransferCore,
  vesselTransferPresentation,
);

// Re-export the server-safe core surface: vesselTransferCore, vesselTransferSchema,
// VesselTransfer, VesselTransferFormValues.
export * from "./core";
