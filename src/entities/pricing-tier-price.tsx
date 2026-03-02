/**
 * Pricing Tier Price Entity Configuration
 *
 * One row per tier x package format x sales channel combination.
 * These are the cells of the pricing matrix.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";

interface PricingTierPrice {
  id: string;
  pricing_tier_id: string;
  format_id: string;
  sales_channel_id: string;
  price: number;
  created_at: string;
  updated_at: string;
}

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
// Entity Configuration
// =============================================================================

export const pricingTierPriceEntity: EntityConfig<PricingTierPrice> = {
  name: "pricing_tier_price",
  table: "pricing_tier_prices",
  displayName: "Pricing Tier Price",
  displayNamePlural: "Pricing Tier Prices",
  description: "Pricing matrix cells: one price per tier x format x channel",
  domain: "sales",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "pricing_tier_id",
      header: "Tier",
      sortable: true,
      relation: {
        entity: "pricing_tier",
        displayField: "name",
      },
    },
    {
      accessorKey: "format_id",
      header: "Format",
      sortable: true,
      relation: {
        entity: "package_type",
        displayField: "name",
      },
    },
    {
      accessorKey: "sales_channel_id",
      header: "Channel",
      sortable: true,
      relation: {
        entity: "sales_channel",
        displayField: "name",
      },
    },
    {
      accessorKey: "price",
      header: "Price",
      sortable: true,
      render: (value) => (value != null ? `$${Number(value).toFixed(2)}` : "—"),
    },
  ],

  defaultSort: { column: "pricing_tier_id", direction: "asc" },
  searchableFields: [],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "price",
  },

  detailSections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        { field: "pricing_tier_id", label: "Pricing Tier" },
        { field: "format_id", label: "Package Format" },
        { field: "sales_channel_id", label: "Sales Channel" },
        { field: "price", label: "Price", format: "currency" },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        {
          name: "pricing_tier_id",
          label: "Pricing Tier",
          type: "select",
          placeholder: "Select tier...",
          required: true,
          colSpan: 4,
          dynamicOptions: {
            table: "pricing_tiers",
            valueField: "id",
            labelField: "name",
            orderBy: "cogs_max",
          },
        },
        {
          name: "format_id",
          label: "Package Format",
          type: "select",
          placeholder: "Select format...",
          required: true,
          colSpan: 4,
          dynamicOptions: {
            table: "packaging_formats",
            valueField: "id",
            labelField: "name",
            orderBy: "name",
            filter: { is_active: true, show_in_pricing: true },
          },
        },
        {
          name: "sales_channel_id",
          label: "Sales Channel",
          type: "select",
          placeholder: "Select channel...",
          required: true,
          colSpan: 4,
          dynamicOptions: {
            table: "sales_channels",
            valueField: "id",
            labelField: "name",
            orderBy: "position",
            filter: { is_active: true },
          },
        },
        {
          name: "price",
          label: "Price",
          type: "number",
          format: "currency",
          placeholder: "e.g., 42.00",
          required: true,
          colSpan: 4,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: pricingTierPriceSchema,

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "pricing_tier",
      entity: "pricing_tier",
      type: "belongsTo",
      foreignKey: "pricing_tier_id",
    },
    {
      name: "package_format",
      entity: "package_type",
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

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "What is the retail price for cases in Tier 1?",
    "Show all prices for the distributor channel",
    "List prices for half barrel kegs across all tiers",
  ],

  keyFields: ["pricing_tier_id", "format_id", "sales_channel_id", "price"],
};
