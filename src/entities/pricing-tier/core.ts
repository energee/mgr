/**
 * Pricing Tier Entity — server-safe core
 *
 * The pure-data half of the pricing tier entity: identity, the zod form
 * schema, relations, and AI metadata. No React imports — safe to import
 * from server route handlers and API routes.
 *
 * Tier definitions for the pricing matrix. Small, rarely-changing set. Each
 * tier defines prices across all package format × sales channel combinations.
 * Tiers are sorted by cogs_max — the lower bound is implicitly the previous
 * tier's upper bound.
 */

import { z } from "zod";
import type { EntityCoreInput } from "@/types/entity";

export type PricingTier = {
  id: string;
  name: string;
  default_upc: string | null;
  cogs_max: number | null;
  created_at: string;
  updated_at: string;
};

// =============================================================================
// Zod Schema
// =============================================================================

export const pricingTierSchema = z.object({
  name: z.string().min(1, "Name is required"),
  default_upc: z.string().nullable().optional(),
  cogs_max: z.coerce.number().min(0).nullable().optional(),
});

export type PricingTierFormValues = z.infer<typeof pricingTierSchema>;

// =============================================================================
// Entity Core
// =============================================================================

export const pricingTierCore: EntityCoreInput<PricingTier> = {
  name: "pricing_tier",
  table: "pricing_tiers",
  displayName: "Pricing Tier",
  description: "Tier definitions for the pricing matrix",
  domain: "sales",
  basePath: "/settings/pricing/tiers",

  // Explicit: tiers sort by their COGS upper bound, not by name.
  defaultSort: { column: "cogs_max", direction: "asc" },

  detailHeader: { title: "name" },

  formSchema: pricingTierSchema,

  relations: [
    {
      name: "pricing_tier_prices",
      entity: "pricing_tier_price",
      type: "hasMany",
      foreignKey: "pricing_tier_id",
      showInDetail: true,
      detailTab: "Prices",
      // Prices have no create route — managed via the /settings/pricing matrix.
      hideAdd: true,
    },
    {
      name: "recipes",
      entity: "recipe",
      type: "hasMany",
      foreignKey: "pricing_tier_id",
      showInDetail: true,
      detailTab: "Recipes",
    },
  ],

  queryExamples: [
    "Show me all pricing tiers",
    "What tier covers COGS up to $8?",
    "List tiers by COGS upper bound",
  ],

  keyFields: ["name", "cogs_max"],
};
