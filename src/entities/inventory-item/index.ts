/**
 * Inventory Item Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `inventoryItemEntity` from `@/entities/inventory-item` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { inventoryItemCore } from "./core";
import { inventoryItemPresentation } from "./presentation";

export const inventoryItemEntity = createEntityConfig(
  inventoryItemCore,
  inventoryItemPresentation,
);

// Re-export the server-safe core surface: inventoryItemCore, inventoryItemSchema,
// InventoryItem, InventoryItemFormValues, categoryDisplayConfig.
export * from "./core";
