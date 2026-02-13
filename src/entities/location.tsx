/**
 * Location Entity Configuration
 *
 * Locations represent physical facilities like breweries, warehouses, taprooms, etc.
 * Vessels, bins, and inventory are assigned to locations for multi-site operations.
 */

import { z } from "zod";
import type { EntityConfig, ValueDisplayConfig } from "@/types/entity";
import { valuesAsOptions, getValueLabel } from "@/types/entity";
import type { Database } from "@/types/supabase";

type Location = Database["public"]["Tables"]["locations"]["Row"];
type LocationWithPos = Location & Pick<
  Database["public"]["Views"]["locations_with_pos"]["Row"],
  "pos_bin_name" | "pos_bin_type"
>;

// =============================================================================
// Zod Schema
// =============================================================================

export const locationSchema = z.object({
  name: z.string().min(1, "Name is required"),
  location_type: z.string().min(1, "Location type is required"),
  is_primary: z.boolean().default(false),
  is_active: z.boolean().default(true),
  square_location_id: z.string().nullable().optional(),
  pos_bin_id: z.string().uuid().nullable().optional(),
});

export type LocationFormValues = z.infer<typeof locationSchema>;

// =============================================================================
// Value Display Configuration
// =============================================================================

const locationTypeDisplayConfig: ValueDisplayConfig = {
  field: "location_type",
  display: {
    brewery: { label: "Brewery" },
    warehouse: { label: "Warehouse" },
    taproom: { label: "Taproom" },
    cold_storage: { label: "Cold Storage" },
    dry_storage: { label: "Dry Storage" },
    production: { label: "Production" },
    offsite: { label: "Offsite" },
  },
};

// Export for backwards compatibility (some components may reference this)
export const LOCATION_TYPES = valuesAsOptions(locationTypeDisplayConfig);

// =============================================================================
// Entity Configuration
// =============================================================================

export const locationEntity: EntityConfig<LocationWithPos> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "location",
  table: "locations",
  viewTable: "locations_with_pos",
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
      render: (value: unknown) => getValueLabel(locationEntity, "location_type", value as string),
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
      options: valuesAsOptions(locationTypeDisplayConfig),
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
    subtitle: "location_type",
  },

  detailSections: [
    {
      id: "overview",
      title: "Location Details",
      fields: [
        { field: "name", label: "Name" },
        { field: "location_type", label: "Type" },
        { field: "is_primary", label: "Primary Location" },
        { field: "is_active", label: "Active" },
        { field: "created_at", label: "Created", format: "datetime" },
        { field: "updated_at", label: "Last Updated", format: "datetime" },
      ],
    },
    {
      id: "pos",
      title: "POS Integration",
      fields: [
        { field: "square_location_id", label: "Square Location ID" },
        { field: "pos_bin_name", label: "POS Inventory Bin" },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Location Details",
      fields: [
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
          options: valuesAsOptions(locationTypeDisplayConfig),
          dynamicOptions: {
            table: "enum_values",
            valueField: "value",
            labelField: "label",
            filter: { enum_type: "location_type" },
            orderBy: "sort_order",
          },
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
    {
      id: "pos",
      title: "POS Integration",
      fields: [
        {
          name: "square_location_id",
          label: "Square Location ID",
          type: "text",
          placeholder: "e.g., LXXXXXXXXXXXXXXXXX",
          description: "The Square Location ID from your Square Dashboard",
          colSpan: 6,
        },
        {
          name: "pos_bin_id",
          label: "POS Inventory Bin",
          type: "relation",
          relation: {
            entity: "bin",
            displayField: "name",
          },
          description: "Finished goods in this bin will sync to Square at this location",
          colSpan: 6,
        },
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
      options: valuesAsOptions(locationTypeDisplayConfig), // Fallback if dynamicOptions fails
      dynamicOptions: {
        table: "enum_values",
        valueField: "value",
        labelField: "label",
        filter: { enum_type: "location_type" },
        orderBy: "sort_order",
      },
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
    {
      name: "square_location_id",
      label: "Square Location ID",
      type: "text",
      placeholder: "e.g., LXXXXXXXXXXXXXXXXX",
      description: "The Square Location ID from your Square Dashboard",
      colSpan: 6,
    },
    {
      name: "pos_bin_id",
      label: "POS Inventory Bin",
      type: "relation",
      relation: {
        entity: "bin",
        displayField: "name",
      },
      description: "Finished goods in this bin will sync to Square at this location",
      colSpan: 6,
    },
  ],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "delete",
      label: "Delete Location",
      icon: "trash",
      type: "dropdown",
      variant: "destructive",
      deleteMode: "hard" as const,
    },
  ],

  // ---------------------------------------------------------------------------
  // Value Display
  // ---------------------------------------------------------------------------
  valueDisplay: [locationTypeDisplayConfig],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "List all locations",
    "Which location is the primary?",
    "Show all warehouses",
  ],

  keyFields: ["name", "location_type", "is_primary", "is_active", "square_location_id"],
};
