/**
 * Bin Entity — server-safe core
 *
 * The pure-data half of the bin entity: identity, the zod form schema,
 * value-display configuration, relations, and AI metadata. No React imports —
 * safe to import from server route handlers and API routes.
 *
 * Bins represent physical storage locations within a facility (e.g., shelves,
 * cold rooms, staging areas). They are assigned to locations and can hold both
 * finished goods and raw material inventory items.
 */

import { z } from "zod";
import type { EntityCore, ValueDisplayConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";

type Bin = Database["public"]["Tables"]["bins"]["Row"];

// Extended type for list view (includes summary fields from bins_with_summary view)
export type BinView = Bin & {
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

export const binTypeDisplayConfig: ValueDisplayConfig = {
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
  // Marks this bin as the location's default finished-goods bin: the fallback
  // placement target for the 00219 place_finished_good_in_bin trigger when a
  // packaging session has no default_bin_id. At most one per location (enforced
  // by the bins_one_default_fg_per_location partial-unique index).
  is_default_fg: z.boolean().default(false),
});

export type BinFormValues = z.infer<typeof binSchema>;

// =============================================================================
// Entity Core
// =============================================================================

export const binCore: EntityCore<Bin> = {
  name: "bin",
  table: "bins",
  viewTable: "bins_with_summary",
  displayName: "Bin",
  displayNamePlural: "Bins",
  description: "Physical storage locations within a facility for inventory items",
  domain: "inventory",

  defaultSort: { column: "name", direction: "asc" },
  searchableFields: ["name"],

  detailHeader: {
    title: "name",
    subtitle: "location_name" as keyof Bin & string,
    badge: "bin_type",
  },

  formSchema: binSchema,

  valueDisplay: [binTypeDisplayConfig],

  relations: [
    {
      name: "location",
      entity: "location",
      type: "belongsTo",
      foreignKey: "location_id",
      showInDetail: true,
    },
  ],

  queryExamples: [
    "Show me all bins in the cold room",
    "Which bins have items in them?",
    "List all quarantine bins",
    "What bins are available at the warehouse?",
    "Find empty bins for staging",
  ],

  keyFields: ["name", "bin_type", "capacity", "is_active"],
};
