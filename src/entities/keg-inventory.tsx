/**
 * Keg Inventory Entity Configuration
 *
 * READ-ONLY calculated view of keg quantities by type, state, and location.
 * Quantities are derived from keg_transactions - following the allocations pattern
 * where balances are calculated, never stored as mutable values.
 *
 * To modify inventory, record a keg transaction instead.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";

// =============================================================================
// Types
// =============================================================================

export type KegState =
  | "empty"
  | "filled"
  | "shipped"
  | "returned_dirty"
  | "cleaning"
  | "maintenance"
  | "retired";

type KegInventory = {
  id: string;
  selling_format_id: string;
  keg_owner_id: string | null;
  state: KegState;
  location_id: string | null;
  quantity: number;
  batch_id: string | null;
  finished_good_id: string | null;
  // Convenience display fields populated by the view from selling_formats/containers
  keg_type_name?: string;
  keg_owner_name?: string;
  volume_bbl?: number;
  location_name?: string;
  batch_code?: string;
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
// Zod Schema (minimal - view is read-only)
// =============================================================================

export const kegInventorySchema = z.object({
  selling_format_id: z.string().uuid(),
  keg_owner_id: z.string().uuid().nullable().optional(),
  state: z.enum(["empty", "filled", "shipped", "returned_dirty", "cleaning", "maintenance", "retired"]),
  location_id: z.string().uuid().nullable().optional(),
  quantity: z.number().int(),
  batch_id: z.string().uuid().nullable().optional(),
  finished_good_id: z.string().uuid().nullable().optional(),
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
  viewTable: "keg_inventory_with_details",
  displayName: "Keg Inventory",
  displayNamePlural: "Keg Inventory",
  description: "Calculated view of keg quantities by type, state, and location (derived from transactions)",
  domain: "inventory",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "keg_type_name",
      header: "Keg Type",
      sortable: true,
    },
    {
      accessorKey: "keg_owner_name",
      header: "Owner",
      sortable: true,
      render: (value: unknown) => (value ? String(value) : "—"),
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
      accessorKey: "location_name",
      header: "Location",
      sortable: true,
      render: (value: unknown) => (value ? String(value) : "—"),
    },
    {
      accessorKey: "batch_code",
      header: "Batch",
      sortable: false,
      render: (value: unknown) => (value ? String(value) : "—"),
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
  searchableFields: ["keg_type_name", "location_name"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "keg_type_name",
    subtitle: "state",
  },

  // ---------------------------------------------------------------------------
  // Unified Sections (for EntityDetailUnified) - READ ONLY
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Keg Inventory Details",
      fields: [
        { name: "keg_type_name", label: "Keg Type", editable: false },
        { name: "keg_owner_name", label: "Owner", editable: false },
        { name: "state", label: "State", editable: false },
        { name: "quantity", label: "Quantity", editable: false },
        { name: "location_name", label: "Location", editable: false },
        { name: "batch_code", label: "Batch", editable: false },
        { name: "finished_good_name", label: "Finished Good", editable: false },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form - READ ONLY (inventory is calculated from transactions)
  // ---------------------------------------------------------------------------
  // Note: This is a calculated view. To modify inventory, record a keg transaction.
  formSchema: kegInventorySchema,
};
