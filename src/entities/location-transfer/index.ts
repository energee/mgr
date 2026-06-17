/**
 * Location Transfer Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `locationTransferEntity` from `@/entities/location-transfer` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { locationTransferCore } from "./core";
import { locationTransferPresentation } from "./presentation";

export const locationTransferEntity = createEntityConfig(
  locationTransferCore,
  locationTransferPresentation,
);

// Re-export the server-safe core surface: locationTransferCore, locationTransferSchema,
// locationTransferStateMachine, statusOptions, LocationTransferView, LocationTransferFormValues.
export * from "./core";
