/**
 * Pricing Tier Entity Configuration
 *
 * Tier definitions for the pricing matrix. Small, rarely-changing set.
 * Each tier defines prices across all package format x sales channel combinations.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";

interface PricingTier {
  id: string;
  name: string;
  sort_order: number;
  default_upc: string | null;
  cogs_min: number | null;
  cogs_max: number | null;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Zod Schema
// =============================================================================

export const pricingTierSchema = z.object({
  name: z.string().min(1, "Name is required"),
  sort_order: z.coerce.number().int().min(0).default(0),
  default_upc: z.string().nullable().optional(),
  cogs_min: z.coerce.number().min(0).nullable().optional(),
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
      accessorKey: "sort_order",
      header: "Order",
      sortable: true,
    },
    {
      accessorKey: "cogs_min",
      header: "COGS Min",
      render: (value) => (value != null ? `$${Number(value).toFixed(2)}` : "—"),
    },
    {
      accessorKey: "cogs_max",
      header: "COGS Max",
      render: (value) => (value != null ? `$${Number(value).toFixed(2)}` : "—"),
    },
    {
      accessorKey: "default_upc",
      header: "Default UPC",
      render: (value) => (value ? String(value) : "—"),
    },
  ],

  defaultSort: { column: "sort_order", direction: "asc" },
  searchableFields: ["name"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "name",
  },

  detailSections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        { field: "name", label: "Name" },
        { field: "sort_order", label: "Sort Order" },
        { field: "default_upc", label: "Default UPC" },
        { field: "cogs_min", label: "COGS Min", format: "currency" },
        { field: "cogs_max", label: "COGS Max", format: "currency" },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: pricingTierSchema,

  formFields: [
    {
      name: "name",
      label: "Tier Name",
      type: "text",
      placeholder: 'e.g., "Tier 1" or "IPA"',
      required: true,
      colSpan: 6,
    },
    {
      name: "sort_order",
      label: "Sort Order",
      type: "number",
      placeholder: "0",
      description: "Controls display ordering in the pricing matrix",
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
    {
      name: "cogs_min",
      label: "COGS Min",
      type: "number",
      placeholder: "e.g., 5.00",
      description: "Lower bound for auto-assignment from recipe COGS",
      colSpan: 6,
    },
    {
      name: "cogs_max",
      label: "COGS Max",
      type: "number",
      placeholder: "e.g., 8.00",
      description: "Upper bound for auto-assignment from recipe COGS",
      colSpan: 6,
    },
  ],

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

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show me all pricing tiers",
    "What tier covers COGS between $5 and $8?",
    "List tiers by sort order",
  ],

  keyFields: ["name", "sort_order", "cogs_min", "cogs_max"],
};
