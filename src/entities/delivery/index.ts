/**
 * Delivery Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `deliveryEntity` from `@/entities/delivery` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { deliveryCore } from "./core";
import { deliveryPresentation } from "./presentation";

export const deliveryEntity = createEntityConfig(
  deliveryCore,
  deliveryPresentation,
);

// Re-export the server-safe core surface: deliveryCore, deliverySchema,
// DeliveryView, DeliveryFormValues, deliveryStateMachine, statusOptions.
export * from "./core";
