/**
 * Package Type Entity Configuration
 *
 * Package types define the physical containers products are packaged into:
 * cans, bottles, kegs, growlers, etc. Each type has a volume and optionally
 * a units-per-case count for packaged goods.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";

type PackageType = Database["public"]["Tables"]["package_types"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const packageTypeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  container_type: z.string().min(1, "Container type is required"),
  volume_oz: z.coerce.number().positive("Volume must be positive"),
  units_per_case: z.coerce.number().int().positive().nullable().optional(),
  inner_pack_size: z.coerce.number().int().positive().nullable().optional(),
  inner_packs_per_case: z.coerce.number().int().positive().nullable().optional(),
  is_active: z.boolean().default(true),
  show_in_pricing: z.boolean().default(false),
}).refine(
  (data) => {
    // If either inner pack field is set, both must be set and units_per_case must equal their product
    const hasInnerPack = data.inner_pack_size != null || data.inner_packs_per_case != null;
    if (!hasInnerPack) return true;

    if (data.inner_pack_size == null || data.inner_packs_per_case == null) {
      return false; // Both must be set if either is set
    }

    if (data.units_per_case == null) return true; // Allow if units_per_case not set

    return data.units_per_case === data.inner_pack_size * data.inner_packs_per_case;
  },
  {
    message: "When using inner packs, units per case must equal inner pack size × inner packs per case",
    path: ["units_per_case"],
  }
);

export type PackageTypeFormValues = z.infer<typeof packageTypeSchema>;

// =============================================================================
// Entity Configuration
// =============================================================================

export const packageTypeEntity: EntityConfig<PackageType> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "package_type",
  table: "package_types",
  displayName: "Package Type",
  displayNamePlural: "Package Types",
  description: "Physical container types for packaging products",
  domain: "inventory",

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
      accessorKey: "container_type",
      header: "Container",
      sortable: true,
      render: (value) => {
        if (!value) return "—";
        const s = String(value);
        return s.charAt(0).toUpperCase() + s.slice(1);
      },
    },
    {
      accessorKey: "volume_oz",
      header: "Volume",
      sortable: true,
      format: "unit",
      unitType: "retail_volume",
    },
    {
      accessorKey: "units_per_case",
      header: "Units/Case",
      sortable: true,
      render: (value) => (value != null ? String(value) : "—"),
    },
    {
      accessorKey: "show_in_pricing",
      header: "Pricing",
      sortable: true,
      render: (value) => (value ? "Yes" : ""),
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
      field: "container_type",
      type: "select",
      label: "Container Type",
      dynamicOptions: {
        table: "enum_values",
        valueField: "value",
        labelField: "label",
        filter: { enum_type: "package_container_type" },
        orderBy: "sort_order",
      },
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

  detailSections: [
    {
      id: "overview",
      title: "Package Type Details",
      fields: [
        { field: "name", label: "Name" },
        { field: "container_type", label: "Container Type" },
        { field: "volume_oz", label: "Volume", format: "unit", unitType: "retail_volume" },
        { field: "units_per_case", label: "Units per Case" },
        { field: "inner_pack_size", label: "Inner Pack Size" },
        { field: "inner_packs_per_case", label: "Inner Packs per Case" },
        { field: "show_in_pricing", label: "Show in Pricing" },
        { field: "is_active", label: "Active" },
        { field: "created_at", label: "Created", format: "datetime" },
        { field: "updated_at", label: "Last Updated", format: "datetime" },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Package Type Details",
      fields: [
        {
          name: "name",
          label: "Name",
          type: "text",
          placeholder: "e.g., 16oz Can, 1/2 BBL Keg",
          required: true,
          colSpan: 6,
        },
        {
          name: "container_type",
          label: "Container Type",
          type: "select",
          dynamicOptions: {
            table: "enum_values",
            valueField: "value",
            labelField: "label",
            filter: { enum_type: "package_container_type" },
            orderBy: "sort_order",
          },
          required: true,
          colSpan: 6,
        },
        {
          name: "volume_oz",
          label: "Volume",
          type: "unit",
          unitType: "retail_volume",
          format: "unit",
          placeholder: "e.g., 16, 128, 1984",
          required: true,
          description: "Package volume",
          colSpan: 6,
        },
        {
          name: "units_per_case",
          label: "Units per Case",
          type: "number",
          placeholder: "e.g., 24, 4",
          description: "Total units per case (auto-calculated if using inner packs)",
          colSpan: 4,
        },
        {
          name: "inner_pack_size",
          label: "Inner Pack Size",
          type: "number",
          placeholder: "e.g., 6",
          description: "Units per inner pack (e.g., 6-pack)",
          colSpan: 4,
        },
        {
          name: "inner_packs_per_case",
          label: "Inner Packs per Case",
          type: "number",
          placeholder: "e.g., 4",
          description: "Number of inner packs per case",
          colSpan: 4,
        },
        {
          name: "show_in_pricing",
          label: "Show in Pricing Matrix",
          type: "switch",
          description: "Include this format as a column in the pricing matrix",
          defaultValue: false,
          colSpan: 6,
        },
        {
          name: "is_active",
          label: "Active",
          type: "switch",
          description: "Inactive types won't appear in dropdown menus",
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
  formSchema: packageTypeSchema,

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "delete",
      label: "Delete Package Type",
      icon: "trash",
      type: "dropdown",
      variant: "destructive",
      deleteMode: "hard",
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show all package types",
    "What keg sizes do we have?",
    "List active can formats",
  ],

  keyFields: ["name", "container_type", "volume_oz", "is_active"],
};
