/**
 * Order Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `orderEntity` from `@/entities/order` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { orderCore } from "./core";
import { orderPresentation } from "./presentation";

export const orderEntity = createEntityConfig(orderCore, orderPresentation);

// Re-export the server-safe core surface: orderCore, orderSchema, orderStateMachine,
// statusOptions, changeRequestStatusDisplay, Order, OrderFormValues.
export * from "./core";
