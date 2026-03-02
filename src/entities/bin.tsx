/**
 * Bin Entity Configuration
 *
 * Bins represent physical storage locations within a facility (e.g., shelves,
 * cold rooms, staging areas). They are assigned to locations and can hold
 * both finished goods and raw material inventory items.
 */

import { z } from "zod";
import type { EntityConfig, ValueDisplayConfig } from "@/types/entity";
import { valuesAsOptions, getValueLabel } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { Badge } from "@/components/ui/badge";

type Bin = Database["public"]["Tables"]["bins"]["Row"];

// Extended type for list view (includes summary fields from bins_with_summary view)
export interface BinView extends Bin {
  location_name: string | null;
  location_type: string | null;
  fg_item_count: number | null;
  rm_item_count: number | null;
  total_item_count: number | null;
}

// =============================================================================
// Constants
// =============================================================================

export const BIN_TYPES = [
  "storage",
  "cold_room",
  "staging",
  "taproom",
  "shipping",
  "hold",
  "quarantine",
] as const;

// =============================================================================
// Value Display Configuration
// =============================================================================

const binTypeDisplayConfig: ValueDisplayConfig = {
  field: "bin_type",
  display: {
    storage: { label: "Storage" },
    cold_room: { label: "Cold Room" },
    staging: { label: "Staging" },
    taproom: { label: "Taproom" },
    shipping: { label: "Shipping" },
    hold: { label: "Hold" },
    quarantine: { label: "Quarantine", color: "warning" },
  },
};

export const binTypeDisplay = binTypeDisplayConfig.display;

// =============================================================================
// Zod Schema
// =============================================================================

export const binSchema = z.object({
  name: z.string().min(1, "Name is required"),
  location_id: z.string({ error: "Location is required" }).uuid("Location is required"),
  bin_type: z.enum([
    "storage",
    "cold_room",
    "staging",
    "taproom",
    "shipping",
    "hold",
    "quarantine",
  ]),
  capacity: z.coerce.number().min(0, "Capacity must be positive").nullable().optional(),
  notes: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
});

export type BinFormValues = z.infer<typeof binSchema>;

// Bin type options derived from display config
const binTypeOptions = valuesAsOptions(binTypeDisplayConfig);

// =============================================================================
// Entity Configuration
// =============================================================================

export const binEntity: EntityConfig<Bin> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "bin",
  table: "bins",
  viewTable: "bins_with_summary",
  displayName: "Bin",
  displayNamePlural: "Bins",
  description: "Physical storage locations within a facility for inventory items",
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
      accessorKey: "location_name",
      header: "Location",
      sortable: true,
    },
    {
      accessorKey: "bin_type",
      header: "Type",
      sortable: true,
      render: (value) => (
        <Badge variant="outline">
          {getValueLabel(binEntity, "bin_type", value as string)}
        </Badge>
      ),
    },
    {
      accessorKey: "capacity",
      header: "Capacity",
      sortable: true,
      format: "number",
    },
    {
      accessorKey: "total_item_count",
      header: "Items",
      sortable: true,
      format: "number",
    },
  ],

  listFilters: [
    {
      field: "bin_type",
      type: "select",
      label: "Type",
      options: binTypeOptions,
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
    subtitle: "location_name" as keyof Bin & string,
    badge: "bin_type",
  },

  detailSections: [
    {
      id: "overview",
      title: "Bin Details",
      fields: [
        { field: "name", label: "Name" },
        {
          field: "location_id",
          label: "Location",
          relation: { entity: "location", displayField: "name" },
        },
        { field: "bin_type", label: "Type" },
        { field: "capacity", label: "Capacity", format: "number" },
        { field: "is_active", label: "Active" },
        { field: "notes", label: "Notes", fullWidth: true },
      ],
    },
    {
      id: "contents_summary",
      title: "Contents Summary",
      fields: [
        { field: "fg_item_count" as keyof Bin & string, label: "Finished Goods Items", format: "number" },
        { field: "rm_item_count" as keyof Bin & string, label: "Raw Material Items", format: "number" },
        { field: "total_item_count" as keyof Bin & string, label: "Total Items", format: "number" },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Unified Sections (for EntityDetailUnified)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Bin Details",
      fields: [
        {
          name: "name",
          label: "Name",
          type: "text",
          placeholder: "e.g., Shelf A-1, Cold Room 1",
          required: true,
          colSpan: 6,
        },
        {
          name: "location_id",
          label: "Location",
          type: "select",
          relation: { entity: "location", displayField: "name" },
          dynamicOptions: {
            table: "locations",
            valueField: "id",
            labelField: "name",
            orderBy: "name",
            filter: { is_active: true },
          },
          required: true,
          colSpan: 6,
        },
        {
          name: "bin_type",
          label: "Type",
          type: "select",
          options: binTypeOptions,
          required: true,
          colSpan: 6,
        },
        {
          name: "capacity",
          label: "Capacity",
          type: "number",
          format: "number",
          placeholder: "e.g., 100",
          description: "Maximum number of items this bin can hold",
          colSpan: 6,
        },
        {
          name: "is_active",
          label: "Active",
          type: "switch",
          description: "Inactive bins won't appear in dropdown menus",
          defaultValue: true,
          colSpan: 6,
        },
        {
          name: "notes",
          label: "Notes",
          type: "textarea",
          placeholder: "Any special notes about this bin...",
          fullWidth: true,
          colSpan: 12,
        },
      ],
    },
    {
      id: "contents_summary",
      title: "Contents Summary",
      fields: [
        { name: "fg_item_count" as keyof Bin & string, label: "Finished Goods Items", format: "number", editable: false, colSpan: 4 },
        { name: "rm_item_count" as keyof Bin & string, label: "Raw Material Items", format: "number", editable: false, colSpan: 4 },
        { name: "total_item_count" as keyof Bin & string, label: "Total Items", format: "number", editable: false, colSpan: 4 },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: binSchema,

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "delete",
      label: "Delete Bin",
      icon: "trash",
      type: "dropdown",
      variant: "destructive",
      deleteMode: "hard",
    },
  ],

  // ---------------------------------------------------------------------------
  // Value Display
  // ---------------------------------------------------------------------------
  valueDisplay: [binTypeDisplayConfig],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "location",
      entity: "location",
      type: "belongsTo",
      foreignKey: "location_id",
      showInDetail: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show me all bins in the cold room",
    "Which bins have items in them?",
    "List all quarantine bins",
    "What bins are available at the warehouse?",
    "Find empty bins for staging",
  ],

  keyFields: ["name", "bin_type", "capacity", "is_active"],
};
