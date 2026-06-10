/**
 * Pricing Tier Entity Configuration
 *
 * Tier definitions for the pricing matrix. Small, rarely-changing set.
 * Each tier defines prices across all package format x sales channel combinations.
 * Tiers are sorted by cogs_max — the lower bound is implicitly the previous tier's upper bound.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";

type PricingTier = {
  id: string;
  name: string;
  default_upc: string | null;
  cogs_max: number | null;
  created_at: string;
  updated_at: string;
}

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
// Entity Configuration
// =============================================================================

export const pricingTierEntity: EntityConfig<PricingTier> = {
  name: "pricing_tier",
  table: "pricing_tiers",
  displayName: "Pricing Tier",
  displayNamePlural: "Pricing Tiers",
  description: "Tier definitions for the pricing matrix",
  domain: "sales",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "name",
      header: "Name",
      sortable: true,
    },
    {
      accessorKey: "cogs_max",
      header: "COGS Upper Bound",
      sortable: true,
      render: (value) => (value != null ? `$${Number(value).toFixed(2)}` : "—"),
    },
    {
      accessorKey: "default_upc",
      header: "Default UPC",
      render: (value) => (value ? String(value) : "—"),
    },
  ],

  defaultSort: { column: "cogs_max", direction: "asc" },
  searchableFields: ["name"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "name",
  },

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        {
          name: "name",
          label: "Tier Name",
          type: "text",
          placeholder: 'e.g., "Tier 1" or "IPA"',
          required: true,
          colSpan: 6,
        },
        {
          name: "cogs_max",
          label: "COGS Upper Bound",
          type: "number",
          format: "currency",
          placeholder: "e.g., 8.00",
          description: "Recipes with COGS up to this value fall in this tier",
          colSpan: 6,
        },
        {
          name: "default_upc",
          label: "Default UPC",
          type: "text",
          placeholder: "e.g., 123456789012",
          description: "Overridden by brand UPC if set",
          colSpan: 12,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: pricingTierSchema,

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "pricing_tier_prices",
      entity: "pricing_tier_price",
      type: "hasMany",
      foreignKey: "pricing_tier_id",
      showInDetail: true,
      detailTab: "Prices",
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
};
