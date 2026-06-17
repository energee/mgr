/**
 * Brew Log Entity — server-safe core
 *
 * The pure-data half of the brew log entity: identity, the zod form schema,
 * event sub-schemas, state machine, relations, and AI metadata. No React
 * imports — safe to import from server route handlers and API routes.
 *
 * Brew logs capture the hot-side brewing process (mash through knockout).
 * They are linked to batches via brew_log_batches junction table.
 * Recipe is derived from linked batches (not stored on brew_logs).
 *
 * Lifecycle: draft → in_progress → completed
 */

import { z } from "zod";
import type { EntityCoreInput, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";

// Use generated type from Supabase (will need regeneration after migration)
export type BrewLog = Database["public"]["Tables"]["brew_logs"]["Row"];

// =============================================================================
// Event Schemas
// =============================================================================

const measurementSchema = z.object({
  metric: z.string().min(1, "Metric is required"),
  value: z.union([z.number(), z.string()]),
  custom_metric: z.string().nullable().optional(),
});

const brewEventSchema = z.object({
  id: z.string().uuid().optional(),
  phase: z.string().min(1, "Phase is required"),
  custom_phase: z.string().nullable().optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Time must be in HH:MM format"),
  measurements: z.array(measurementSchema).default([]),
  ingredient: z.object({
    type: z.string(),
    id: z.string().uuid(),
  }).nullable().optional(),
  vessel: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
});

// =============================================================================
// Zod Schema
// =============================================================================

export const brewLogSchema = z.object({
  brew_number: z.string().min(1, "Brew number is required"),
  brew_date: z.string().min(1, "Brew date is required"),
  brewer_id: z.string().uuid().nullable().optional(),
  status: z.string().default("draft"),
  events: z.array(brewEventSchema).default([]),
  notes: z.string().nullable().optional(),
});

export type BrewLogFormValues = z.infer<typeof brewLogSchema>;
export type BrewEvent = z.infer<typeof brewEventSchema>;
export type BrewMeasurement = z.infer<typeof measurementSchema>;

// =============================================================================
// State Machine (defined separately to derive options)
// =============================================================================

export const brewLogStateMachine: StateMachineConfig<BrewLog> = {
  stateField: "status",
  states: ["draft", "in_progress", "completed", "cancelled"],
  initialState: "draft",
  transitions: {
    draft: ["in_progress", "cancelled"],
    in_progress: ["completed", "cancelled"],
    completed: [],
    cancelled: [],
  },
  stateDisplay: {
    draft: { label: "Draft", color: "default" },
    in_progress: { label: "In Progress", color: "info" },
    completed: { label: "Completed", color: "success" },
    cancelled: { label: "Cancelled", color: "error" },
  },
};

// Derive status options from state machine (single source of truth)
export const statusOptions = statesAsOptions(brewLogStateMachine);

// =============================================================================
// Entity Core
// =============================================================================

export const brewLogCore: EntityCoreInput<BrewLog> = {
  name: "brew_log",
  table: "brew_logs",
  viewTable: "brew_logs_with_batches",
  displayName: "Brew Log",
  description: "Brew day records capturing the hot-side process from mash through knockout",
  domain: "production",

  // Explicit: sorted by most-recent brew date first.
  defaultSort: { column: "brew_date", direction: "desc" },
  searchableFields: ["brew_number"],

  detailHeader: {
    title: "brew_number",
    subtitle: "brew_date",
    badge: "status",
  },

  formSchema: brewLogSchema,

  stateMachine: brewLogStateMachine,

  relations: [
    {
      name: "brewer",
      entity: "user_profile",
      type: "belongsTo",
      foreignKey: "brewer_id",
      showInDetail: true,
    },
  ],

  queryExamples: [
    "Show me all brews from this week",
    "What brews are currently in progress?",
    "Find brews linked to batch B-20240115-01",
    "Which brewer did BRW-2024-015?",
  ],

  keyFields: ["brew_number", "brew_date", "status"],
};
