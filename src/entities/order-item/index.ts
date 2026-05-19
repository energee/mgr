/**
 * Order Item Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `orderItemEntity` from `@/entities/order-item` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { orderItemCore } from "./core";
import { orderItemPresentation } from "./presentation";

export const orderItemEntity = createEntityConfig(orderItemCore, orderItemPresentation);

// Re-export the server-safe core surface: orderItemCore, orderItemSchema,
// OrderItem, OrderItemFormValues.
export * from "./core";
