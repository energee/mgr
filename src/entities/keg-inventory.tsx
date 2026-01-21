/**
 * Keg Inventory Entity Configuration
 *
 * Tracks keg quantities by type, state, and location.
 * Kegs move through states: empty → filled → shipped → returned_dirty → cleaning → empty
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";

// =============================================================================
// Types (until Supabase types are regenerated)
// =============================================================================

export type KegState =
  | "empty"
  | "filled"
  | "shipped"
  | "returned_dirty"
  | "cleaning"
  | "maintenance"
  | "retired";

interface KegInventory {
  id: string;
  keg_type_id: string;
  state: KegState;
  location_id: string | null;
  quantity: number;
  batch_id: string | null;
  finished_good_id: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  // Joined fields from view
  keg_type_name?: string;
  keg_type_code?: string;
  location_name?: string;
  batch_number?: string;
  finished_good_name?: string;
}

// =============================================================================
// Keg State Options
// =============================================================================

export const KEG_STATES: { value: KegState; label: string; description: string }[] = [
  { value: "empty", label: "Empty", description: "Clean, ready to fill" },
  { value: "filled", label: "Filled", description: "Filled with beer" },
  { value: "shipped", label: "Shipped", description: "Out with customer" },
  { value: "returned_dirty", label: "Returned (Dirty)", description: "Returned, needs cleaning" },
  { value: "cleaning", label: "Cleaning", description: "In cleaning process" },
  { value: "maintenance", label: "Maintenance", description: "Out for repair" },
  { value: "retired", label: "Retired", description: "No longer in service" },
];

// =============================================================================
// Zod Schema
// =============================================================================

export const kegInventorySchema = z.object({
  keg_type_id: z.string().uuid("Select a keg type"),
  state: z.enum(["empty", "filled", "shipped", "returned_dirty", "cleaning", "maintenance", "retired"]),
  location_id: z.string().uuid().nullable().optional(),
  quantity: z.coerce.number().int().min(0, "Quantity must be 0 or more"),
  batch_id: z.string().uuid().nullable().optional(),
  finished_good_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type KegInventoryFormValues = z.infer<typeof kegInventorySchema>;

// =============================================================================
// Entity Configuration
// =============================================================================

export const kegInventoryEntity: EntityConfig<KegInventory> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "keg_inventory",
  table: "keg_inventory",
  displayName: "Keg Inventory",
  displayNamePlural: "Keg Inventory",
  description: "Track keg quantities by type, state, and location",
  domain: "inventory",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "keg_type_id",
      header: "Keg Type",
      sortable: true,
      // Will show keg_type_name from joined data
    },
    {
      accessorKey: "state",
      header: "State",
      sortable: true,
      render: (value: unknown) => {
        const state = KEG_STATES.find((s) => s.value === value);
        return state?.label || String(value);
      },
    },
    {
      accessorKey: "quantity",
      header: "Quantity",
      sortable: true,
    },
    {
      accessorKey: "location_id",
      header: "Location",
      sortable: true,
      // Will show location_name from joined data
    },
  ],

  listFilters: [
    {
      field: "state",
      type: "select",
      label: "State",
      options: KEG_STATES.map((s) => ({ value: s.value, label: s.label })),
    },
  ],

  defaultSort: { column: "state", direction: "asc" },
  searchableFields: [],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "keg_type_id",
    subtitle: "state",
  },

  detailSections: [
    {
      id: "overview",
      title: "Keg Inventory Details",
      fields: [
        { field: "keg_type_id", label: "Keg Type" },
        { field: "state", label: "State" },
        { field: "quantity", label: "Quantity" },
        { field: "location_id", label: "Location" },
        { field: "batch_id", label: "Batch" },
        { field: "finished_good_id", label: "Finished Good" },
        { field: "notes", label: "Notes" },
        { field: "created_at", label: "Created", format: "datetime" },
        { field: "updated_at", label: "Last Updated", format: "datetime" },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: kegInventorySchema,

  formFields: [
    {
      name: "keg_type_id",
      label: "Keg Type",
      type: "relation",
      relation: { entity: "keg_type", displayField: "name" },
      required: true,
      colSpan: 6,
    },
    {
      name: "state",
      label: "State",
      type: "select",
      options: KEG_STATES.map((s) => ({ value: s.value, label: s.label })),
      required: true,
      colSpan: 6,
    },
    {
      name: "quantity",
      label: "Quantity",
      type: "number",
      placeholder: "0",
      required: true,
      colSpan: 6,
    },
    {
      name: "location_id",
      label: "Location",
      type: "relation",
      relation: { entity: "location", displayField: "name" },
      colSpan: 6,
    },
    {
      name: "batch_id",
      label: "Batch (for filled kegs)",
      type: "relation",
      relation: { entity: "batch", displayField: "batch_number" },
      description: "Only applicable for filled kegs",
      colSpan: 6,
    },
    {
      name: "finished_good_id",
      label: "Finished Good (for filled kegs)",
      type: "relation",
      relation: { entity: "finished_good", displayField: "name" },
      description: "Only applicable for filled kegs",
      colSpan: 6,
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      placeholder: "Optional notes about this inventory",
      colSpan: 12,
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "How many empty kegs do we have?",
    "Show keg inventory by type",
    "Which kegs are shipped out?",
    "What's the total keg count by state?",
  ],

  keyFields: ["keg_type_id", "state", "quantity", "location_id"],
};
