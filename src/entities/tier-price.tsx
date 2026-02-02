/**
 * Tier Price Entity Configuration
 *
 * Specific prices for format/brand/style combinations within a price tier.
 * Supports brand-specific, style-specific, and generic format prices.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";

interface TierPrice {
  id: string;
  price_tier_id: string;
  format_id: string;
  brand_id: string | null;
  style_id: string | null;
  price: number;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Zod Schema
// =============================================================================

export const tierPriceSchema = z.object({
  price_tier_id: z.string().uuid("Price tier is required"),
  format_id: z.string().uuid("Format is required"),
  brand_id: z.string().uuid().nullable().optional(),
  style_id: z.string().uuid().nullable().optional(),
  price: z.coerce.number().min(0, "Price must be positive"),
  effective_from: z.string().optional(),
  effective_to: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type TierPriceFormValues = z.infer<typeof tierPriceSchema>;

// =============================================================================
// Entity Configuration
// =============================================================================

export const tierPriceEntity: EntityConfig<TierPrice> = {
  name: "tier_price",
  table: "tier_prices",
  displayName: "Tier Price",
  displayNamePlural: "Tier Prices",
  description: "Specific prices for format/brand/style within a tier",
  domain: "sales",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "price_tier_id",
      header: "Price Tier",
      sortable: true,
      relation: {
        entity: "price_tier",
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
      accessorKey: "brand_id",
      header: "Brand",
      relation: {
        entity: "brand",
        displayField: "name",
      },
      render: (value, row) => {
        if (row?.brand_id) return undefined; // Let relation handle it
        if (row?.style_id) return "(by style)";
        return "(all brands)";
      },
    },
    {
      accessorKey: "price",
      header: "Price",
      sortable: true,
      render: (value) => (value != null ? `$${Number(value).toFixed(2)}` : "—"),
    },
    {
      accessorKey: "effective_from",
      header: "Effective",
      sortable: true,
      format: "date",
    },
  ],

  defaultSort: { column: "price_tier_id", direction: "asc" },
  searchableFields: ["notes"],

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
        { field: "price_tier_id", label: "Price Tier" },
        { field: "format_id", label: "Format" },
        { field: "brand_id", label: "Brand" },
        { field: "style_id", label: "Style" },
        { field: "price", label: "Price", format: "currency" },
        { field: "effective_from", label: "Effective From", format: "date" },
        { field: "effective_to", label: "Effective To", format: "date" },
        { field: "notes", label: "Notes" },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: tierPriceSchema,

  formFields: [
    {
      name: "price_tier_id",
      label: "Price Tier",
      type: "select",
      placeholder: "Select price tier...",
      required: true,
      colSpan: 6,
      dynamicOptions: {
        table: "price_tiers",
        valueField: "id",
        labelField: "name",
        orderBy: "name",
        filter: { is_active: true },
      },
    },
    {
      name: "format_id",
      label: "Package Format",
      type: "select",
      placeholder: "Select format...",
      required: true,
      colSpan: 6,
      dynamicOptions: {
        table: "package_types",
        valueField: "id",
        labelField: "name",
        orderBy: "position,name",
        filter: { is_active: true },
      },
    },
    {
      name: "brand_id",
      label: "Brand (optional)",
      type: "select",
      placeholder: "All brands...",
      description: "Leave empty for a generic price, or select a specific brand",
      colSpan: 6,
      dynamicOptions: {
        table: "brands",
        valueField: "id",
        labelField: "name",
        orderBy: "name",
        filter: { is_active: true },
      },
    },
    {
      name: "style_id",
      label: "Style (optional)",
      type: "select",
      placeholder: "All styles...",
      description: "For style-based pricing (lower priority than brand)",
      colSpan: 6,
      dynamicOptions: {
        table: "beer_styles",
        valueField: "id",
        labelField: "name",
        orderBy: "category,name",
      },
    },
    {
      name: "price",
      label: "Price per Unit",
      type: "number",
      placeholder: "e.g., 42.00",
      required: true,
      colSpan: 4,
    },
    {
      name: "effective_from",
      label: "Effective From",
      type: "date",
      colSpan: 4,
    },
    {
      name: "effective_to",
      label: "Effective To",
      type: "date",
      description: "Leave empty for current price",
      colSpan: 4,
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      placeholder: "Any notes about this price...",
      colSpan: 12,
    },
  ],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "price_tier",
      entity: "price_tier",
      type: "belongsTo",
      foreignKey: "price_tier_id",
    },
    {
      name: "format",
      entity: "package_type",
      type: "belongsTo",
      foreignKey: "format_id",
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "What is the distributor price for 1/2 BBL kegs?",
    "Show me all prices for Hazy IPA",
    "List brand-specific prices",
  ],

  keyFields: ["price_tier_id", "format_id", "brand_id", "price"],
};
