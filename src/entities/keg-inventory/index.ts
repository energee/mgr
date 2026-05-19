/**
 * Keg Inventory Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `kegInventoryEntity` from `@/entities/keg-inventory` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { kegInventoryCore } from "./core";
import { kegInventoryPresentation } from "./presentation";

export const kegInventoryEntity = createEntityConfig(
  kegInventoryCore,
  kegInventoryPresentation,
);

// Re-export the server-safe core surface: kegInventoryCore, kegInventorySchema,
// KegInventory, KegInventoryFormValues, KegState, KEG_STATES.
export * from "./core";
