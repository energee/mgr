/**
 * Brew Log Entity Configuration
 *
 * Brew logs capture the hot-side brewing process (mash through knockout).
 * They are decoupled from batches to support:
 * - Split fermentation (1 brew → multiple batches)
 * - Parti-gyle brewing
 * - Blend at knockout
 *
 * Lifecycle: draft → in_progress → completed
 */

import { z } from "zod";
import type { EntityConfig, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { StatusBadge } from "@/components/universal/status-badge";
import { BrewLogTimeline } from "@/components/domain/brew-log-timeline";
import { BrewLogSplitOverview } from "@/components/domain/brew-log-split-overview";

// Use generated type from Supabase (will need regeneration after migration)
type BrewLog = Database["public"]["Tables"]["brew_logs"]["Row"];

// =============================================================================
// Event Schemas
// =============================================================================

const measurementSchema = z.object({
  metric: z.enum([
    "temp_f",
    "ph",
    "volume_bbl",
    "volume_l",
    "gravity_plato",
    "flow_rate",
    "pump_speed",
    "amount_lbs",
    "amount_oz",
    "amount_g",
    "viability",
    "pitch_rate",
    "other",
  ]),
  value: z.union([z.number(), z.string()]),
  custom_metric: z.string().nullable().optional(),
});

const brewEventSchema = z.object({
  id: z.string().uuid().optional(),
  phase: z.enum([
    "strike_water",
    "mash_in",
    "mash_rest",
    "mash_step",
    "vorlauf",
    "runoff_start",
    "runoff_end",
    "sparge_start",
    "sparge_end",
    "kettle_full",
    "boil_start",
    "boil_end",
    "hop_addition",
    "adjunct_addition",
    "whirlpool_start",
    "whirlpool_rest",
    "whirlpool_end",
    "ko_start",
    "ko_end",
    "yeast_pitch",
    "hourly_check",
    "flow_rate_change",
    "other",
  ]),
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
  recipe_id: z.string().uuid().nullable().optional(),
  brewer_id: z.string().uuid().nullable().optional(),
  status: z.string().default("draft"),
  events: z.array(brewEventSchema).default([]),
  notes: z.string().nullable().optional(),
});

export type BrewLogFormValues = z.infer<typeof brewLogSchema>;
export type BrewEvent = z.infer<typeof brewEventSchema>;
export type BrewMeasurement = z.infer<typeof measurementSchema>;

// =============================================================================
// Phase Display Config
// =============================================================================

export const phaseConfig = {
  strike_water: { label: "Strike Water", icon: "droplet" },
  mash_in: { label: "Mash In", icon: "grain" },
  mash_rest: { label: "Mash Rest", icon: "clock" },
  mash_step: { label: "Mash Step", icon: "thermometer" },
  vorlauf: { label: "Vorlauf", icon: "refresh" },
  runoff_start: { label: "Runoff Start", icon: "arrow-down" },
  runoff_end: { label: "Runoff End", icon: "check" },
  sparge_start: { label: "Sparge Start", icon: "droplet" },
  sparge_end: { label: "Sparge End", icon: "check" },
  kettle_full: { label: "Kettle Full", icon: "container" },
  boil_start: { label: "Boil Start", icon: "flame" },
  boil_end: { label: "Boil End", icon: "check" },
  hop_addition: { label: "Hop Addition", icon: "leaf" },
  adjunct_addition: { label: "Adjunct Addition", icon: "plus" },
  whirlpool_start: { label: "Whirlpool Start", icon: "refresh" },
  whirlpool_rest: { label: "Whirlpool Rest", icon: "clock" },
  whirlpool_end: { label: "Whirlpool End", icon: "check" },
  ko_start: { label: "Knock Out Start", icon: "arrow-right" },
  ko_end: { label: "Knock Out End", icon: "check" },
  yeast_pitch: { label: "Yeast Pitch", icon: "flask" },
  hourly_check: { label: "Hourly Check", icon: "clock" },
  flow_rate_change: { label: "Flow Rate Change", icon: "sliders" },
  other: { label: "Other", icon: "more-horizontal" },
} as const;

// =============================================================================
// Metric Display Config
// =============================================================================

export const metricConfig = {
  temp_f: { label: "Temperature", unit: "°F", unitType: "temperature" as const, decimals: 1 },
  ph: { label: "pH", unit: "" },
  volume_bbl: { label: "Volume (BBL)", unit: "BBL", unitType: "volume" as const, decimals: 2 },
  volume_l: { label: "Volume (L)", unit: "L", unitType: "volume" as const, decimals: 2 },
  gravity_plato: { label: "Gravity", unit: "°P", unitType: "gravity" as const, decimals: 1 },
  flow_rate: { label: "Flow Rate", unit: "" },
  pump_speed: { label: "Pump Speed", unit: "" },
  amount_lbs: { label: "Amount (lbs)", unit: "lbs", unitType: "weight" as const, decimals: 2 },
  amount_oz: { label: "Amount (oz)", unit: "oz" },
  amount_g: { label: "Amount (g)", unit: "g" },
  viability: { label: "Viability", unit: "%" },
  pitch_rate: { label: "Pitching Rate", unit: "M/mL/°P" },
  other: { label: "Other", unit: "" },
} as const;

// =============================================================================
// State Machine (defined separately to derive options)
// =============================================================================

const brewLogStateMachine: StateMachineConfig<BrewLog> = {
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
const statusOptions = statesAsOptions(brewLogStateMachine);

// =============================================================================
// Entity Configuration
// =============================================================================

export const brewLogEntity: EntityConfig<BrewLog> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "brew_log",
  table: "brew_logs",
  displayName: "Brew Log",
  displayNamePlural: "Brew Logs",
  description: "Brew day records capturing the hot-side process from mash through knockout",
  domain: "production",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "brew_number",
      header: "Brew #",
      sortable: true,
    },
    {
      accessorKey: "brew_date",
      header: "Brew Date",
      sortable: true,
      format: "date",
    },
    {
      accessorKey: "status",
      header: "Status",
      sortable: true,
      render: (value) => (
        <StatusBadge
          status={value as string}
          config={brewLogEntity.stateMachine?.stateDisplay}
        />
      ),
    },
    {
      accessorKey: "recipe_id",
      header: "Recipe",
      relation: {
        entity: "recipe",
        displayField: "name",
      },
    },
  ],

  listFilters: [
    {
      field: "status",
      type: "multiselect",
      label: "Status",
      options: [
        { value: "draft", label: "Draft" },
        { value: "in_progress", label: "In Progress" },
        { value: "completed", label: "Completed" },
        { value: "cancelled", label: "Cancelled" },
      ],
    },
  ],

  defaultSort: { column: "brew_date", direction: "desc" },
  searchableFields: ["brew_number"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "brew_number",
    subtitle: "brew_date",
    badge: "status",
  },

  detailSections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        { field: "brew_number", label: "Brew Number" },
        { field: "brew_date", label: "Brew Date", format: "date" },
        { field: "status", label: "Status" },
      ],
    },
    {
      id: "timeline",
      title: "Brew Day Timeline",
      component: BrewLogTimeline,
    },
    {
      id: "split-overview",
      title: "Batch Splits",
      component: BrewLogSplitOverview,
    },
    {
      id: "notes",
      title: "Notes",
      fields: [
        { field: "notes", label: "Notes", fullWidth: true },
      ],
      collapsible: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Unified Sections (for EntityDetailUnified)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        {
          name: "brew_number",
          label: "Brew Number",
          type: "text",
          placeholder: "e.g., BRW-2024-001",
          required: true,
          colSpan: 6,
        },
        {
          name: "brew_date",
          label: "Brew Date",
          type: "date",
          format: "date",
          required: true,
          colSpan: 6,
        },
        {
          name: "recipe_id",
          label: "Recipe",
          type: "relation",
          relation: { entity: "recipe", displayField: "name" },
          colSpan: 6,
        },
        {
          name: "brewer_id",
          label: "Brewer",
          type: "relation",
          relation: { entity: "user", displayField: "full_name" },
          colSpan: 6,
        },
        {
          name: "status",
          label: "Status",
          type: "select",
          options: statusOptions,
          colSpan: 6,
        },
      ],
    },
    {
      id: "timeline",
      title: "Brew Day Timeline",
      component: BrewLogTimeline,
    },
    {
      id: "batches",
      title: "Linked Batches",
      component: BrewLogSplitOverview,
    },
    {
      id: "notes",
      title: "Notes",
      collapsible: true,
      fields: [
        {
          name: "notes",
          label: "Notes",
          type: "textarea",
          fullWidth: true,
          colSpan: 12,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: brewLogSchema,

  formFields: [
    {
      name: "brew_number",
      label: "Brew Number",
      type: "text",
      placeholder: "e.g., BRW-2024-001",
      required: true,
      colSpan: 6,
    },
    {
      name: "brew_date",
      label: "Brew Date",
      type: "date",
      required: true,
      colSpan: 6,
    },
    {
      name: "recipe_id",
      label: "Recipe",
      type: "relation",
      relation: {
        entity: "recipe",
        displayField: "name",
      },
      colSpan: 6,
    },
    {
      name: "brewer_id",
      label: "Brewer",
      type: "relation",
      relation: {
        entity: "user",
        displayField: "full_name",
      },
      colSpan: 6,
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      options: statusOptions,
      colSpan: 6,
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      colSpan: 12,
    },
  ],

  // ---------------------------------------------------------------------------
  // State Machine
  // ---------------------------------------------------------------------------
  stateMachine: brewLogStateMachine,

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "start_brew",
      label: "Start Brew",
      icon: "play",
      type: "button",
      fromStates: ["draft"],
      toState: "in_progress",
    },
    {
      name: "complete_brew",
      label: "Complete Brew",
      icon: "check",
      type: "button",
      fromStates: ["in_progress"],
      toState: "completed",
    },
    {
      name: "cancel",
      label: "Cancel",
      icon: "x",
      type: "dropdown",
      variant: "destructive",
      fromStates: ["draft", "in_progress"],
      toState: "cancelled",
      confirm: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "recipe",
      entity: "recipe",
      type: "belongsTo",
      foreignKey: "recipe_id",
      showInDetail: true,
    },
    {
      name: "brewer",
      entity: "user_profile",
      type: "belongsTo",
      foreignKey: "brewer_id",
      showInDetail: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show me all brews from this week",
    "What brews are currently in progress?",
    "Find brews for the Hazy IPA recipe",
    "Which brewer did BRW-2024-015?",
  ],

  keyFields: ["brew_number", "brew_date", "status", "recipe_id"],
};
