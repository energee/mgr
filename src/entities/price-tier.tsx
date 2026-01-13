/**
 * Price Tier Entity Configuration
 *
 * Price tiers define pricing levels (Wholesale, Retail, Premium)
 * mapped to sales channels for automatic price resolution.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import { Badge } from "@/components/ui/badge";

// Temporary type until migration is applied and types regenerated
type PriceTier = {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

// =============================================================================
// Zod Schema
// =============================================================================

export const priceTierSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().nullable().optional(),
  sort_order: z.coerce.number().int().default(0),
  is_active: z.boolean().default(true),
});

export type PriceTierFormValues = z.infer<typeof priceTierSchema>;

// =============================================================================
// Entity Configuration
// =============================================================================

export const priceTierEntity: EntityConfig<PriceTier> = {
  name: "price_tier",
  table: "price_tiers",
  displayName: "Price Tier",
  displayNamePlural: "Price Tiers",
  description: "Price tier definitions for order pricing",
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
      accessorKey: "description",
      header: "Description",
    },
    {
      accessorKey: "sort_order",
      header: "Order",
      sortable: true,
    },
    {
      accessorKey: "is_active",
      header: "Status",
      render: (value) => (
        <Badge variant={value ? "default" : "secondary"}>
          {value ? "Active" : "Inactive"}
        </Badge>
      ),
    },
  ],

  listFilters: [
    {
      field: "is_active",
      type: "select",
      label: "Status",
      options: [
        { value: "true", label: "Active" },
        { value: "false", label: "Inactive" },
      ],
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
        { field: "description", label: "Description" },
        { field: "sort_order", label: "Sort Order" },
        { field: "is_active", label: "Active" },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: priceTierSchema,

  formFields: [
    {
      name: "name",
      label: "Tier Name",
      type: "text",
      placeholder: "e.g., Wholesale",
      required: true,
      colSpan: 6,
    },
    {
      name: "sort_order",
      label: "Sort Order",
      type: "number",
      placeholder: "0",
      colSpan: 3,
    },
    {
      name: "is_active",
      label: "Active",
      type: "switch",
      colSpan: 3,
    },
    {
      name: "description",
      label: "Description",
      type: "textarea",
      colSpan: 12,
    },
  ],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "tier_prices",
      entity: "tier_price",
      type: "hasMany",
      foreignKey: "tier_id",
      showInDetail: true,
      detailTab: "Prices",
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "List all price tiers",
    "Show active tiers",
    "Get tier pricing",
  ],

  keyFields: ["name", "sort_order", "is_active"],
};
