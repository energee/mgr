/**
 * Yeast Strain Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `yeastStrainEntity` from `@/entities/yeast-strain` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { yeastStrainCore } from "./core";
import { yeastStrainPresentation } from "./presentation";

export const yeastStrainEntity = createEntityConfig(
  yeastStrainCore,
  yeastStrainPresentation,
);

// Re-export the server-safe core surface: yeastStrainCore, yeastStrainSchema,
// typeDisplayConfig, formDisplayConfig, flocculationDisplayConfig,
// typeOptions, formOptions, flocculationOptions, Yeast, YeastStrainFormValues.
export * from "./core";
