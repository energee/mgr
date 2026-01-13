/**
 * Sales Channel Entity Configuration
 *
 * Sales channels define how customers purchase (distributor, retail, taproom, etc.)
 * Used for price tier resolution.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import { Badge } from "@/components/ui/badge";

// Temporary type until migration is applied and types regenerated
type SalesChannel = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

// =============================================================================
// Zod Schema
// =============================================================================

export const salesChannelSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z.string().min(1, "Slug is required").regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens"),
  description: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
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
  description: "Sales channel definitions for pricing",
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
      accessorKey: "slug",
      header: "Slug",
    },
    {
      accessorKey: "description",
      header: "Description",
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

  defaultSort: { column: "name", direction: "asc" },
  searchableFields: ["name", "slug"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "name",
    subtitle: "slug",
  },

  detailSections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        { field: "name", label: "Name" },
        { field: "slug", label: "Slug" },
        { field: "description", label: "Description" },
        { field: "is_active", label: "Active" },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: salesChannelSchema,

  formFields: [
    {
      name: "name",
      label: "Channel Name",
      type: "text",
      placeholder: "e.g., Wholesale",
      required: true,
      colSpan: 6,
    },
    {
      name: "slug",
      label: "Slug",
      type: "text",
      placeholder: "e.g., wholesale",
      required: true,
      colSpan: 6,
      description: "URL-safe identifier (lowercase, hyphens only)",
    },
    {
      name: "description",
      label: "Description",
      type: "textarea",
      colSpan: 12,
    },
    {
      name: "is_active",
      label: "Active",
      type: "switch",
      colSpan: 12,
    },
  ],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "customers",
      entity: "customer",
      type: "hasMany",
      foreignKey: "sales_channel_id",
      showInDetail: true,
      detailTab: "Customers",
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "List all sales channels",
    "Show active channels",
    "Get channel by slug",
  ],

  keyFields: ["name", "slug", "is_active"],
};
