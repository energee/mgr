/**
 * Purchase Order Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `purchaseOrderEntity` from `@/entities/purchase-order` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { purchaseOrderCore } from "./core";
import { purchaseOrderPresentation } from "./presentation";

export const purchaseOrderEntity = createEntityConfig(
  purchaseOrderCore,
  purchaseOrderPresentation,
);

// Re-export the server-safe core surface: purchaseOrderCore, purchaseOrderSchema,
// purchaseOrderStateMachine, statusOptions, PurchaseOrder, PurchaseOrderFormValues.
export * from "./core";
