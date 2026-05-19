/**
 * Bin Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `binEntity` from `@/entities/bin` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { binCore } from "./core";
import { binPresentation } from "./presentation";

export const binEntity = createEntityConfig(binCore, binPresentation);

// Re-export the server-safe core surface: binCore, binSchema, BinFormValues,
// BinView, BIN_TYPES, binTypeDisplayConfig, binTypeDisplay.
export * from "./core";
