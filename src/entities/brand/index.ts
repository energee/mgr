/**
 * Brand Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `brandEntity` from `@/entities/brand` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { brandCore } from "./core";
import { brandPresentation } from "./presentation";

export const brandEntity = createEntityConfig(brandCore, brandPresentation);

// Re-export the server-safe core surface: brandCore, brandSchema,
// Brand, BrandFormValues.
export * from "./core";
