/**
 * Keg Owner Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `kegOwnerEntity` from `@/entities/keg-owner` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { kegOwnerCore } from "./core";
import { kegOwnerPresentation } from "./presentation";

export const kegOwnerEntity = createEntityConfig(
  kegOwnerCore,
  kegOwnerPresentation,
);

// Re-export the server-safe core surface: kegOwnerCore, kegOwnerSchema,
// KegOwner, KegOwnerFormValues.
export * from "./core";
