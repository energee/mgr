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
  is_active: z.boolean().default(true),
});

export type PackageTypeFormValues = z.infer<typeof packageTypeSchema>;

// =============================================================================
// Constants
// =============================================================================

const CONTAINER_TYPE_OPTIONS = [
  { value: "can", label: "Can" },
  { value: "bottle", label: "Bottle" },
  { value: "keg", label: "Keg" },
  { value: "growler", label: "Growler" },
  { value: "crowler", label: "Crowler" },
  { value: "other", label: "Other" },
];

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
        const option = CONTAINER_TYPE_OPTIONS.find((o) => o.value === value);
        return option?.label || String(value);
      },
    },
    {
      accessorKey: "volume_oz",
      header: "Volume (oz)",
      sortable: true,
    },
    {
      accessorKey: "units_per_case",
      header: "Units/Case",
      sortable: true,
      render: (value) => (value != null ? String(value) : "—"),
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
      options: [{ value: "", label: "All" }, ...CONTAINER_TYPE_OPTIONS],
    },
    {
      field: "is_active",
      type: "boolean",
      label: "Active Only",
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
        { field: "volume_oz", label: "Volume (oz)" },
        { field: "units_per_case", label: "Units per Case" },
        { field: "is_active", label: "Active" },
        { field: "created_at", label: "Created", format: "datetime" },
        { field: "updated_at", label: "Last Updated", format: "datetime" },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: packageTypeSchema,

  formFields: [
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
      options: CONTAINER_TYPE_OPTIONS,
      required: true,
      colSpan: 6,
    },
    {
      name: "volume_oz",
      label: "Volume (oz)",
      type: "number",
      placeholder: "e.g., 16, 128, 1984",
      required: true,
      description: "Volume in fluid ounces",
      colSpan: 6,
    },
    {
      name: "units_per_case",
      label: "Units per Case",
      type: "number",
      placeholder: "e.g., 24, 4",
      description: "For cans/bottles: how many per case",
      colSpan: 6,
    },
    {
      name: "is_active",
      label: "Active",
      type: "switch",
      description: "Inactive types won't appear in dropdown menus",
      defaultValue: true,
      colSpan: 12,
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
