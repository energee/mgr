/**
 * Location Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `locationEntity` from `@/entities/location` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { locationCore } from "./core";
import { locationPresentation } from "./presentation";

export const locationEntity = createEntityConfig(locationCore, locationPresentation);

// Re-export the server-safe core surface: locationCore, locationSchema,
// LocationFormValues, locationTypeDisplayConfig, LOCATION_TYPES, LocationWithPos.
export * from "./core";
