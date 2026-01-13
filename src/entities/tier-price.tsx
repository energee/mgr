/**
 * Tier Price Entity Configuration
 *
 * Tier prices define specific pricing by tier, product (brand/style),
 * and package type with temporal validity.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatCurrency } from "@/lib/utils";

// Temporary type until migration is applied and types regenerated
type TierPrice = {
  id: string;
  tier_id: string;
  brand_id: string | null;
  style_id: string | null;
  package_type_id: string;
  price: number;
  valid_from: string;
  valid_to: string | null;
  created_at: string;
  updated_at: string;
};

// =============================================================================
// Zod Schema
// =============================================================================

export const tierPriceSchema = z.object({
  tier_id: z.string().uuid("Price tier is required"),
  brand_id: z.string().uuid().nullable().optional(),
  style_id: z.string().uuid().nullable().optional(),
  package_type_id: z.string().uuid("Package type is required"),
  price: z.coerce.number().min(0, "Price must be positive"),
  valid_from: z.string().optional(),
  valid_to: z.string().nullable().optional(),
}).refine(
  (data) => data.brand_id || data.style_id,
  { message: "Either brand or style must be selected", path: ["brand_id"] }
);

export type TierPriceFormValues = z.infer<typeof tierPriceSchema>;

// =============================================================================
// Entity Configuration
// =============================================================================

export const tierPriceEntity: EntityConfig<TierPrice> = {
  name: "tier_price",
  table: "tier_prices",
  displayName: "Tier Price",
  displayNamePlural: "Tier Prices",
  description: "Price definitions by tier, product, and package type",
  domain: "sales",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "tier_id",
      header: "Price Tier",
      relation: {
        entity: "price_tier",
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
      render: (value) => {
        if (value) return String(value);
        return <span className="text-muted-foreground italic">Style fallback</span>;
      },
    },
    {
      accessorKey: "style_id",
      header: "Style",
      relation: {
        entity: "beer_style",
        displayField: "name",
      },
    },
    {
      accessorKey: "package_type_id",
      header: "Package",
      relation: {
        entity: "package_type",
        displayField: "name",
      },
    },
    {
      accessorKey: "price",
      header: "Price",
      sortable: true,
      format: "currency",
    },
    {
      accessorKey: "valid_from",
      header: "Valid From",
      sortable: true,
      format: "date",
    },
    {
      accessorKey: "valid_to",
      header: "Valid To",
      render: (value) =>
        value ? (
          formatDate(value as string)
        ) : (
          <Badge variant="secondary">Ongoing</Badge>
        ),
    },
  ],

  listFilters: [],

  defaultSort: { column: "valid_from", direction: "desc" },
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
        { field: "tier_id", label: "Price Tier" },
        { field: "brand_id", label: "Brand" },
        { field: "style_id", label: "Style (fallback)" },
        { field: "package_type_id", label: "Package Type" },
        { field: "price", label: "Price", format: "currency" },
      ],
    },
    {
      id: "validity",
      title: "Validity Period",
      fields: [
        { field: "valid_from", label: "Valid From", format: "date" },
        { field: "valid_to", label: "Valid To", format: "date" },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: tierPriceSchema,

  formFields: [
    {
      name: "tier_id",
      label: "Price Tier",
      type: "relation",
      required: true,
      colSpan: 6,
      relation: {
        entity: "price_tier",
        displayField: "name",
      },
    },
    {
      name: "package_type_id",
      label: "Package Type",
      type: "relation",
      required: true,
      colSpan: 6,
      relation: {
        entity: "package_type",
        displayField: "name",
      },
    },
    {
      name: "brand_id",
      label: "Brand",
      type: "relation",
      colSpan: 6,
      description: "Specific brand pricing (takes precedence over style)",
      relation: {
        entity: "brand",
        displayField: "name",
      },
    },
    {
      name: "style_id",
      label: "Style (Fallback)",
      type: "relation",
      colSpan: 6,
      description: "Style-level pricing when no brand price exists",
      relation: {
        entity: "beer_style",
        displayField: "name",
      },
    },
    {
      name: "price",
      label: "Price",
      type: "number",
      required: true,
      placeholder: "0.00",
      colSpan: 4,
    },
    {
      name: "valid_from",
      label: "Valid From",
      type: "date",
      colSpan: 4,
    },
    {
      name: "valid_to",
      label: "Valid To",
      type: "date",
      colSpan: 4,
      description: "Leave blank for ongoing pricing",
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
      foreignKey: "tier_id",
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Get price for brand and package in tier",
    "Find style fallback prices",
    "Show current valid prices",
    "List prices expiring this month",
  ],

  keyFields: ["tier_id", "brand_id", "style_id", "package_type_id", "price"],
};
