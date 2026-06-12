/**
 * Sales Channel Entity Configuration
 *
 * Sales channels categorize customers for pricing purposes.
 * Common channels: Distributor, Retailer, Taproom, Export.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { orderEntity } from "./order";

const cutoffStateOptions = statesAsOptions(orderEntity.stateMachine!).filter(
  (opt) => opt.value !== "cancelled"
);

type SalesChannelBase = Database["public"]["Tables"]["sales_channels"]["Row"];
type SalesChannel = SalesChannelBase & {
  change_request_cutoff_state?: string | null;
};

// =============================================================================
// Zod Schema
// =============================================================================

export const salesChannelSchema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required").max(20, "Code must be 20 characters or less"),
  description: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
  position: z.coerce.number().int().nullable().optional(),
  change_request_cutoff_state: z.string().default("confirmed"),
});

export type SalesChannelFormValues = z.infer<typeof salesChannelSchema>;

// =============================================================================
// Entity Configuration
// =============================================================================

export const salesChannelEntity: EntityConfig<SalesChannel> = {
  name: "sales_channel",
  table: "sales_channels",
  displayName: "Sales Channel",
  displayNamePlural: "Sales Channels",
  description: "Sales channel categories for customer pricing",
  domain: "sales",
  basePath: "/settings/sales-channels",

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
      accessorKey: "code",
      header: "Code",
      sortable: true,
    },
    {
      accessorKey: "description",
      header: "Description",
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
  ],

  defaultSort: { column: "name", direction: "asc" },
  searchableFields: ["name", "code", "description"],

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
          label: "Name",
          type: "text",
          placeholder: "e.g., Distributor",
          required: true,
          colSpan: 6,
        },
        {
          name: "code",
          label: "Code",
          type: "text",
          placeholder: "e.g., dist",
          description: "Short code for this channel",
          required: true,
          colSpan: 6,
        },
        {
          name: "description",
          label: "Description",
          type: "textarea",
          placeholder: "Describe this sales channel...",
          colSpan: 12,
        },
        {
          name: "position",
          label: "Display Order",
          type: "number",
          placeholder: "e.g., 1",
          colSpan: 6,
        },
        {
          name: "is_active",
          label: "Active",
          type: "switch",
          defaultValue: true,
          colSpan: 6,
        },
      ],
    },
    {
      id: "customer-portal",
      title: "Customer Portal",
      fields: [
        {
          name: "change_request_cutoff_state",
          label: "Change request cutoff",
          type: "select",
          description: "Customers can request order changes until this state",
          options: cutoffStateOptions,
          colSpan: 6,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: salesChannelSchema,

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "delete",
      label: "Delete Sales Channel",
      icon: "trash",
      type: "dropdown",
      variant: "destructive",
      deleteMode: "hard",
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
      foreignKey: "sales_channel_id",
      showInDetail: true,
      detailTab: "Prices",
      // Prices have no create route — managed via the /settings/pricing matrix.
      hideAdd: true,
    },
    {
      name: "customers",
      entity: "customer",
      type: "hasMany",
      foreignKey: "sales_channel_id",
      showInDetail: true,
      detailTab: "Customers",
    },
  ],
};
