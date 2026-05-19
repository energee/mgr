/**
 * Pricing Tier Price Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `pricingTierPriceEntity` from `@/entities/pricing-tier-price` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { pricingTierPriceCore } from "./core";
import { pricingTierPricePresentation } from "./presentation";

export const pricingTierPriceEntity = createEntityConfig(
  pricingTierPriceCore,
  pricingTierPricePresentation,
);

// Re-export the server-safe core surface: pricingTierPriceCore, pricingTierPriceSchema,
// PricingTierPrice, PricingTierPriceFormValues.
export * from "./core";
