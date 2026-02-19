/**
 * Brew Log Entity Configuration
 *
 * Brew logs capture the hot-side brewing process (mash through knockout).
 * They are linked to batches via brew_log_batches junction table.
 * Recipe is derived from linked batches (not stored on brew_logs).
 *
 * Lifecycle: draft → in_progress → completed
 */

import { z } from "zod";
import type { EntityConfig, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { StatusBadge } from "@/components/universal/status-badge";
import { BrewLogTimeline } from "@/components/domain/brew-log-timeline";
import { BrewEventTimelineActions } from "@/components/domain/brew-event-timeline";
import { BrewLogSplitOverview } from "@/components/domain/brew-log-split-overview";
import { createRevisionHistoryDisplay } from "@/components/domain/revision-history-display";

// Use generated type from Supabase (will need regeneration after migration)
type BrewLog = Database["public"]["Tables"]["brew_logs"]["Row"];

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
  viewTable: "brew_logs_with_batches",
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
      accessorKey: "batch_numbers",
      header: "Batches",
    },
  ],

  listFilters: [
    {
      field: "status",
      type: "multiselect",
      label: "Status",
      options: statusOptions,
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
          editable: false,
          colSpan: 6,
        },
        {
          name: "brew_date",
          label: "Brew Date",
          type: "date",
          format: "date",
          editable: false,
          colSpan: 6,
        },
        {
          name: "brewer_id",
          label: "Brewer",
          type: "relation",
          relation: { entity: "user_profile", displayField: "display_name" },
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
      headerActions: BrewEventTimelineActions,
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
    {
      id: "revision-history",
      title: "Revision History",
      component: createRevisionHistoryDisplay("brew_logs"),
      collapsible: true,
      defaultCollapsed: true,
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
      colSpan: 6,
    },
    {
      name: "brew_date",
      label: "Brew Date",
      type: "date",
      colSpan: 6,
    },
    {
      name: "brewer_id",
      label: "Brewer",
      type: "relation",
      relation: {
        entity: "user_profile",
        displayField: "display_name",
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
    "Find brews linked to batch B-20240115-01",
    "Which brewer did BRW-2024-015?",
  ],

  keyFields: ["brew_number", "brew_date", "status"],
};
