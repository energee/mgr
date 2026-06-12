/**
 * Container Entity Configuration
 *
 * Containers represent physical vessels — cans, bottles, kegs.
 * Parent of selling_formats which define how containers are grouped for sale.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";

type Container = Database["public"]["Tables"]["containers"]["Row"];

// =============================================================================
// Constants
// =============================================================================

const CONTAINER_TYPE_OPTIONS = [
  { value: "package", label: "Package" },
  { value: "keg", label: "Keg" },
];

// =============================================================================
// Zod Schema
// =============================================================================

export const containerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.string().min(1, "Type is required"),
  volume_oz: z.coerce.number().positive("Volume must be positive").nullable().optional(),
  volume_bbl: z.coerce.number().positive("Volume must be positive").nullable().optional(),
  deposit_amount: z.coerce.number().min(0, "Deposit cannot be negative").default(0),
  is_active: z.boolean().default(true),
  position: z.coerce.number().int().min(0).default(0),
}).refine(
  (data) => data.type !== "package" || (data.volume_oz != null && data.volume_oz > 0),
  { message: "Package containers require volume in oz", path: ["volume_oz"] }
).refine(
  (data) => data.type !== "keg" || (data.volume_bbl != null && data.volume_bbl > 0),
  { message: "Keg containers require volume in BBL", path: ["volume_bbl"] }
);

export type ContainerFormValues = z.infer<typeof containerSchema>;

// =============================================================================
// Entity Configuration
// =============================================================================

export const containerEntity: EntityConfig<Container> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "container",
  table: "containers",
  displayName: "Container",
  displayNamePlural: "Containers",
  description: "Physical vessels — cans, bottles, kegs. Parent of selling formats.",
  domain: "inventory",
  basePath: "/settings/containers",

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
      accessorKey: "type",
      header: "Type",
      sortable: true,
      render: (value) => {
        const option = CONTAINER_TYPE_OPTIONS.find((o) => o.value === value);
        return option?.label || String(value);
      },
    },
    {
      accessorKey: "volume_oz",
      header: "Volume (oz)",
      sortable: true,
      render: (value) => (value != null ? String(value) : "—"),
    },
    {
      accessorKey: "volume_bbl",
      header: "Volume",
      sortable: true,
      format: "unit",
      unitType: "volume",
    },
    {
      accessorKey: "deposit_amount",
      header: "Deposit",
      sortable: true,
      format: "currency",
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
      field: "type",
      type: "select",
      label: "Type",
      options: CONTAINER_TYPE_OPTIONS,
    },
    {
      field: "is_active",
      type: "boolean",
      label: "Active",
    },
  ],

  defaultSort: { column: "name", direction: "asc" },
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
      title: "Container Details",
      fields: [
        {
          name: "name",
          label: "Name",
          type: "text",
          placeholder: "e.g., 12oz Can, 1/2 Barrel",
          required: true,
          colSpan: 6,
        },
        {
          name: "type",
          label: "Type",
          type: "select",
          options: CONTAINER_TYPE_OPTIONS,
          required: true,
          colSpan: 6,
        },
        {
          name: "volume_oz",
          label: "Volume (oz)",
          type: "number",
          placeholder: "e.g., 12, 16, 128",
          description: "Volume in fluid ounces (for package containers)",
          colSpan: 4,
        },
        {
          name: "volume_bbl",
          label: "Volume",
          type: "unit",
          unitType: "volume",
          format: "unit",
          placeholder: "e.g., 0.5, 0.1667",
          description: "Volume in barrels for TTB reporting (for keg containers)",
          colSpan: 4,
        },
        {
          name: "deposit_amount",
          label: "Deposit",
          type: "number",
          format: "currency",
          placeholder: "e.g., 30.00",
          description: "Deposit charged to customers (kegs)",
          colSpan: 4,
        },
        {
          name: "position",
          label: "Display Order",
          type: "number",
          placeholder: "e.g., 10, 20, 30",
          description: "Order in dropdown menus (lower numbers appear first)",
          colSpan: 6,
        },
        {
          name: "is_active",
          label: "Active",
          type: "switch",
          description: "Inactive containers won't appear in dropdown menus",
          defaultValue: true,
          colSpan: 6,
        },
        {
          name: "created_at",
          label: "Created",
          format: "datetime",
          editable: false,
          colSpan: 6,
        },
        {
          name: "updated_at",
          label: "Last Updated",
          format: "datetime",
          editable: false,
          colSpan: 6,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: containerSchema,

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "selling_formats",
      entity: "selling_format",
      foreignKey: "container_id",
      type: "hasMany",
    },
  ],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "delete",
      label: "Delete Container",
      icon: "trash",
      type: "dropdown",
      variant: "destructive",
      deleteMode: "hard",
    },
  ],
};
