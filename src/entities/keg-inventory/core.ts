/**
 * Keg Inventory Entity — server-safe core
 *
 * The pure-data half of the keg inventory entity: identity, the zod form
 * schema, and AI metadata. No React imports — safe to import from server
 * route handlers and API routes.
 *
 * READ-ONLY calculated view of keg quantities by type, state, and location.
 * Quantities are derived from keg_transactions — following the allocations
 * pattern where balances are calculated, never stored as mutable values.
 * To modify inventory, record a keg transaction instead.
 */

import { z } from "zod";
import type { EntityCoreInput } from "@/types/entity";

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

export type KegInventory = {
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
};

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
// Zod Schema (minimal — view is read-only)
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
// Entity Core
// =============================================================================

export const kegInventoryCore: EntityCoreInput<KegInventory> = {
  name: "keg_inventory",
  table: "keg_inventory",
  viewTable: "keg_inventory_with_details",
  displayName: "Keg Inventory",
  // Explicit: identical singular and plural — not the default +s pattern.
  displayNamePlural: "Keg Inventory",
  description: "Calculated view of keg quantities by type, state, and location (derived from transactions)",
  domain: "inventory",
  basePath: "/inventory/kegs",

  // Explicit: sort by state, not by name.
  defaultSort: { column: "state", direction: "asc" },
  searchableFields: ["keg_type_name", "location_name"],

  detailHeader: {
    title: "keg_type_name",
    subtitle: "state",
  },

  formSchema: kegInventorySchema,

  queryExamples: [
    "How many empty kegs do we have?",
    "Show keg inventory by type",
    "Which kegs are shipped out?",
    "What's the total keg count by state?",
  ],

  keyFields: ["selling_format_id", "keg_owner_id", "state", "quantity", "location_id"],
};
