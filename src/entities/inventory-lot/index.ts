/**
 * Inventory Lot Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `inventoryLotEntity` from `@/entities/inventory-lot` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { inventoryLotCore } from "./core";
import { inventoryLotPresentation } from "./presentation";

export const inventoryLotEntity = createEntityConfig(
  inventoryLotCore,
  inventoryLotPresentation,
);

// Re-export the server-safe core surface: inventoryLotCore, inventoryLotSchema,
// InventoryLot, InventoryLotFormValues.
export * from "./core";
