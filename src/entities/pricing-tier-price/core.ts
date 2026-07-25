/**
 * Pricing Tier Price Entity — server-safe core
 *
 * The pure-data half of the pricing tier price entity: identity, the zod form
 * schema, relations, and AI metadata. No React imports — safe to import from
 * server route handlers and API routes.
 *
 * One row per tier x package format x sales channel combination.
 * These are the cells of the pricing matrix.
 */

import { z } from "zod";
import type { EntityCoreInput } from "@/types/entity";

// =============================================================================
// Types
// =============================================================================

export type PricingTierPrice = {
  id: string;
  pricing_tier_id: string;
  format_id: string;
  sales_channel_id: string;
  price: number;
  created_at: string;
  updated_at: string;
};

// =============================================================================
// Zod Schema
// =============================================================================

export const pricingTierPriceSchema = z.object({
  pricing_tier_id: z.string().uuid("Pricing tier is required"),
  format_id: z.string().uuid("Package format is required"),
  sales_channel_id: z.string().uuid("Sales channel is required"),
  price: z.coerce.number().min(0, "Price must be positive"),
});

export type PricingTierPriceFormValues = z.infer<typeof pricingTierPriceSchema>;

// =============================================================================
// Entity Core
// =============================================================================

export const pricingTierPriceCore: EntityCoreInput<PricingTierPrice> = {
  name: "pricing_tier_price",
  table: "pricing_tier_prices",
  displayName: "Pricing Tier Price",
  domain: "sales",
  // Inline-only: prices are managed via the pricing matrix at /settings/pricing.
  basePath: null,

  // Explicit: sort by pricing_tier_id, not by name.
  defaultSort: { column: "pricing_tier_id", direction: "asc" },
  // Explicit: no searchable text fields on this entity.
  searchableFields: [],

  detailHeader: {
    title: "price",
  },

  formSchema: pricingTierPriceSchema,

  relations: [
    {
      name: "pricing_tier",
      entity: "pricing_tier",
      type: "belongsTo",
      foreignKey: "pricing_tier_id",
    },
    {
      name: "selling_format",
      entity: "selling_format",
      type: "belongsTo",
      foreignKey: "format_id",
    },
    {
      name: "sales_channel",
      entity: "sales_channel",
      type: "belongsTo",
      foreignKey: "sales_channel_id",
    },
  ],

  keyFields: ["pricing_tier_id", "format_id", "sales_channel_id", "price"],
};
