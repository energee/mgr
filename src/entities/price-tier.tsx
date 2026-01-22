/**
 * Price Tier Entity Configuration
 *
 * Price tiers define pricing levels within each sales channel.
 * Example: "Distributor Standard", "Distributor Premium", "Retail Standard"
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";

interface PriceTier {
  id: string;
  name: string;
  sales_channel_id: string;
  description: string | null;
  is_default: boolean;
  discount_percent: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Zod Schema
// =============================================================================

export const priceTierSchema = z.object({
  name: z.string().min(1, "Name is required"),
  sales_channel_id: z.string().uuid("Sales channel is required"),
  description: z.string().nullable().optional(),
  is_default: z.boolean().default(false),
  discount_percent: z.coerce.number().min(0).max(100).nullable().optional(),
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
  description: "Pricing tiers within sales channels",
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
      accessorKey: "sales_channel_id",
      header: "Channel",
      sortable: true,
      relation: {
        entity: "sales_channel",
        displayField: "name",
      },
    },
    {
      accessorKey: "is_default",
      header: "Default",
      sortable: true,
      render: (value) => (value ? "Yes" : ""),
    },
    {
      accessorKey: "discount_percent",
      header: "Discount %",
      render: (value) => (value ? `${value}%` : "—"),
    },
    {
      accessorKey: "is_active",
      header: "Active",
      sortable: true,
      render: (value) => (value ? "Yes" : "No"),
    },
  ],

  listFilters: [
    {
      field: "is_active",
      type: "boolean",
      label: "Active",
    },
    {
      field: "is_default",
      type: "boolean",
      label: "Default Tiers Only",
    },
  ],

  defaultSort: { column: "name", direction: "asc" },
  searchableFields: ["name", "description"],

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
        { field: "sales_channel_id", label: "Sales Channel" },
        { field: "description", label: "Description" },
        { field: "is_default", label: "Default Tier" },
        { field: "discount_percent", label: "Global Discount %" },
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
      placeholder: "e.g., Standard",
      required: true,
      colSpan: 6,
    },
    {
      name: "sales_channel_id",
      label: "Sales Channel",
      type: "select",
      placeholder: "Select channel...",
      required: true,
      colSpan: 6,
      dynamicOptions: {
        table: "sales_channels",
        valueField: "id",
        labelField: "name",
        orderBy: "position",
        filter: { is_active: true },
      },
    },
    {
      name: "description",
      label: "Description",
      type: "textarea",
      placeholder: "Describe this price tier...",
      colSpan: 12,
    },
    {
      name: "discount_percent",
      label: "Global Discount %",
      type: "number",
      placeholder: "e.g., 10",
      description: "Optional discount applied to all prices in this tier",
      colSpan: 4,
    },
    {
      name: "is_default",
      label: "Default Tier",
      type: "switch",
      description: "Use as default for new customers in this channel",
      defaultValue: false,
      colSpan: 4,
    },
    {
      name: "is_active",
      label: "Active",
      type: "switch",
      defaultValue: true,
      colSpan: 4,
    },
  ],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "sales_channel",
      entity: "sales_channel",
      type: "belongsTo",
      foreignKey: "sales_channel_id",
    },
    {
      name: "tier_prices",
      entity: "tier_price",
      type: "hasMany",
      foreignKey: "price_tier_id",
      showInDetail: true,
      detailTab: "Prices",
    },
    {
      name: "customers",
      entity: "customer",
      type: "hasMany",
      foreignKey: "price_tier_id",
      showInDetail: true,
      detailTab: "Customers",
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show me all price tiers for distributors",
    "What is the default tier for retail?",
    "List tiers with discounts",
  ],

  keyFields: ["name", "sales_channel_id", "is_default", "is_active"],
};
