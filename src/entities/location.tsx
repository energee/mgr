/**
 * Location Entity Configuration
 *
 * Locations represent physical facilities like breweries, warehouses, taprooms, etc.
 * Vessels, bins, and inventory are assigned to locations for multi-site operations.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";

type Location = Database["public"]["Tables"]["locations"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const locationSchema = z.object({
  name: z.string().min(1, "Name is required"),
  location_type: z.string().min(1, "Location type is required"),
  is_primary: z.boolean().default(false),
  is_active: z.boolean().default(true),
});

export type LocationFormValues = z.infer<typeof locationSchema>;

// =============================================================================
// Location Type Options
// =============================================================================

export const LOCATION_TYPES = [
  { value: "brewery", label: "Brewery" },
  { value: "warehouse", label: "Warehouse" },
  { value: "taproom", label: "Taproom" },
  { value: "cold_storage", label: "Cold Storage" },
  { value: "offsite", label: "Offsite" },
];

// =============================================================================
// Entity Configuration
// =============================================================================

export const locationEntity: EntityConfig<Location> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "location",
  table: "locations",
  displayName: "Location",
  displayNamePlural: "Locations",
  description: "Physical facilities for production, storage, and sales",
  domain: "system",

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
      accessorKey: "location_type",
      header: "Type",
      sortable: true,
      render: (value: unknown) => {
        const type = LOCATION_TYPES.find((t) => t.value === value);
        return type?.label || String(value);
      },
    },
    {
      accessorKey: "is_primary",
      header: "Primary",
      sortable: true,
      render: (value: unknown) => (value ? "Yes" : "No"),
    },
    {
      accessorKey: "is_active",
      header: "Active",
      sortable: true,
      render: (value: unknown) => (value ? "Yes" : "No"),
    },
  ],

  listFilters: [
    {
      field: "location_type",
      type: "select",
      label: "Type",
      options: LOCATION_TYPES,
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
    subtitle: "location_type",
  },

  detailSections: [
    {
      id: "overview",
      title: "Location Details",
      fields: [
        { field: "name", label: "Name" },
        { field: "location_type", label: "Type" },
        { field: "address", label: "Address" },
        { field: "is_primary", label: "Primary Location" },
        { field: "is_active", label: "Active" },
        { field: "created_at", label: "Created", format: "datetime" },
        { field: "updated_at", label: "Last Updated", format: "datetime" },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: locationSchema,

  formFields: [
    {
      name: "name",
      label: "Name",
      type: "text",
      placeholder: "e.g., Main Brewery, Downtown Taproom",
      required: true,
      colSpan: 6,
    },
    {
      name: "location_type",
      label: "Type",
      type: "select",
      options: LOCATION_TYPES,
      required: true,
      colSpan: 6,
    },
    {
      name: "is_primary",
      label: "Primary Location",
      type: "switch",
      description: "Default location for new vessels and inventory",
      colSpan: 6,
    },
    {
      name: "is_active",
      label: "Active",
      type: "switch",
      description: "Inactive locations won't appear in dropdown menus",
      defaultValue: true,
      colSpan: 6,
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "List all locations",
    "Which location is the primary?",
    "Show all warehouses",
  ],

  keyFields: ["name", "location_type", "is_primary", "is_active"],
};
