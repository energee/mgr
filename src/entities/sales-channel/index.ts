/**
 * Sales Channel Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `salesChannelEntity` from `@/entities/sales-channel` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { salesChannelCore } from "./core";
import { salesChannelPresentation } from "./presentation";

export const salesChannelEntity = createEntityConfig(
  salesChannelCore,
  salesChannelPresentation,
);

// Re-export the server-safe core surface: salesChannelCore, salesChannelSchema,
// SalesChannel, SalesChannelFormValues.
export * from "./core";
