/**
 * Yeast Pitch Entity — server-safe core
 *
 * The pure-data half of the yeast pitch entity: identity, the zod form schema,
 * state machine, and AI metadata. No React imports — safe to import from server
 * route handlers and API routes.
 *
 * Tracks individual yeast pitches with brink-based weight tracking. Supports
 * lineage tracking, viability decay, and usage history via pitch events.
 * Weight is tracked in lbs, cell counts in thousands of cells.
 */

import { z } from "zod";
import type { EntityCoreInput } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";

// Use the view type for computed fields (quantity_remaining_lbs, viability, etc.)
// NOTE: Supabase types must be regenerated after migration to include this view.
export type YeastPitch = Database["public"]["Views"]["yeast_pitches_with_remaining"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const yeastPitchSchema = z.object({
  strain_id: z.string().uuid("Select a yeast strain"),
  source_type: z.enum(["purchase", "harvest"]),
  parent_pitch_id: z.string().uuid().nullable().optional(),
  status: z.enum(["in_stock", "in_use", "harvested", "depleted", "discarded"]).default("in_stock"),
  volume_ml: z.coerce.number().min(0).nullable().optional(),
  cell_count_thousand: z.coerce.number().min(0).nullable().optional(),
  cell_density_thousand: z.coerce.number().min(0).nullable().optional(),
  quantity_lbs: z.coerce.number().min(0).nullable().optional(),
  vessel_id: z.string().uuid().nullable().optional(),
  initial_viability: z.coerce.number().min(0).max(100).default(95).nullable().optional(),
  cost: z.coerce.number().min(0).nullable().optional(),
  received_date: z.string().nullable().optional(),
  harvest_date: z.string().nullable().optional(),
  use_by_date: z.string().nullable().optional(),
  location_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type YeastPitchFormValues = z.infer<typeof yeastPitchSchema>;

// =============================================================================
// Constants
// =============================================================================

export const SOURCE_TYPE_OPTIONS = [
  { value: "purchase", label: "Purchase" },
  { value: "harvest", label: "Harvest" },
];

export const STATUS_DISPLAY: Record<string, { label: string; color: "error" | "default" | "success" | "warning" | "info" }> = {
  in_stock: { label: "In Stock", color: "success" },
  in_use: { label: "In Use", color: "info" },
  harvested: { label: "Harvested", color: "default" },
  depleted: { label: "Depleted", color: "warning" },
  discarded: { label: "Discarded", color: "error" },
};

/** Viability status display config — uses the same color tokens as StatusBadge. */
export const VIABILITY_STATUS_DISPLAY: Record<string, { label: string; color: "default" | "success" | "warning" | "error" | "info" }> = {
  excellent: { label: "Excellent", color: "success" },
  good: { label: "Good", color: "default" },
  marginal: { label: "Marginal", color: "warning" },
  low: { label: "Low", color: "error" },
  inactive: { label: "Inactive", color: "default" },
};

// =============================================================================
// State Machine
// =============================================================================

const yeastPitchStates: string[] = ["in_stock", "in_use", "harvested", "depleted", "discarded"];

export const yeastPitchStateMachine = {
  stateField: "status" as const,
  initialState: "in_stock" as const,
  states: yeastPitchStates,
  transitions: {
    // Atomic pitch recording can consume the entire source in one command.
    in_stock: ["in_use", "depleted", "discarded"],
    in_use: ["harvested", "depleted", "discarded"],
    harvested: [] as string[],
    depleted: [] as string[],
    discarded: [] as string[],
  },
  stateDisplay: STATUS_DISPLAY,
};

// Derive status options from state machine (single source of truth per DEC-007)
export const statusOptions = statesAsOptions(yeastPitchStateMachine);

// =============================================================================
// Entity Core
// =============================================================================

export const yeastPitchCore: EntityCoreInput<YeastPitch> = {
  name: "yeast_pitch",
  table: "yeast_pitches",
  viewTable: "yeast_pitches_with_remaining",
  displayName: "Yeast Pitch",
  // Explicit: irregular plural (Pitch → Pitches, not +s).
  displayNamePlural: "Yeast Pitches",
  description: "Individual yeast pitches tracking lineage, viability, and usage",
  domain: "production",
  basePath: "/production/yeast-pitches",

  // Explicit: sort by age ascending, not by name.
  defaultSort: { column: "days_old", direction: "asc" },
  searchableFields: ["strain_name", "strain_code", "notes"],

  detailHeader: {
    title: "strain_name",
    subtitle: "source_type",
    badge: "status",
  },

  formSchema: yeastPitchSchema,

  stateMachine: yeastPitchStateMachine,

  relations: [
    {
      name: "Children",
      entity: "yeast_pitch",
      type: "hasMany",
      foreignKey: "parent_pitch_id",
    },
    {
      name: "pitch_events",
      entity: "yeast_pitch_event",
      type: "hasMany",
      foreignKey: "pitch_id",
      showInDetail: true,
      hideAdd: true,
      detailTab: "Usage History",
    },
  ],

  queryExamples: [
    "Show available yeast pitches",
    "What's the viability of our lager yeast?",
    "List pitches from WLP001",
    "Show yeast in stock",
    "What generation is our house yeast at?",
    "How much yeast is remaining in the brink?",
    "Show pitch usage history",
  ],

  keyFields: ["strain_id", "source_type", "status", "generation", "estimated_viability", "vessel_id", "quantity_remaining_lbs"],
};
