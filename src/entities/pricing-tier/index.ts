/**
 * Pricing Tier Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `pricingTierEntity` from `@/entities/pricing-tier` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { pricingTierCore } from "./core";
import { pricingTierPresentation } from "./presentation";

export const pricingTierEntity = createEntityConfig(
  pricingTierCore,
  pricingTierPresentation,
);

// Re-export the server-safe core surface: pricingTierCore, pricingTierSchema,
// PricingTier, PricingTierFormValues.
export * from "./core";
