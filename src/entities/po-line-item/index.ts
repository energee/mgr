/**
 * PO Line Item Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `poLineItemEntity` from `@/entities/po-line-item` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { poLineItemCore } from "./core";
import { poLineItemPresentation } from "./presentation";

export const poLineItemEntity = createEntityConfig(
  poLineItemCore,
  poLineItemPresentation,
);

// Re-export the server-safe core surface: poLineItemCore, poLineItemSchema,
// POLineItem, POLineItemFormValues, CATALOG_TYPES, CATALOG_TABLES,
// getCatalogTypeLabel, isFreeTextCatalogType, resolveCatalogNames.
export * from "./core";
