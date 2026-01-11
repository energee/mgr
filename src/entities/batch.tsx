/**
 * Batch Entity Configuration
 *
 * Batches represent the cold-side production process: fermentation through packaging.
 * Hot-side brewing data (brew date, OG, timeline) is captured in brew_logs and
 * linked via brew_log_batches junction table.
 *
 * This decoupling supports:
 * - Split fermentation (1 brew → multiple batches)
 * - Parti-gyle brewing
 * - Blend at knockout
 *
 * Lifecycle: planned → fermenting → conditioning → packaging → completed
 */

import { z } from "zod";
import type { EntityConfig, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { StatusBadge } from "@/components/universal/status-badge";

// Use generated type from Supabase
type Batch = Database["public"]["Tables"]["batches"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const batchSchema = z.object({
  batch_number: z.string().min(1, "Batch number is required"),
  name: z.string().min(1, "Name is required"),
  status: z.string().default("planned"),
  recipe_id: z.string().uuid().nullable().optional(),
  planned_start_date: z.string().nullable().optional(),  // Planned fermentation start
  volume_bbl: z.coerce.number().nullable().optional(),   // Stored in BBL (canonical unit)
  fermenter: z.string().nullable().optional(),
  // Note: actual_og and actual brew_date come from linked brew_logs
  actual_fg: z.coerce.number().nullable().optional(),
  actual_abv: z.coerce.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type BatchFormValues = z.infer<typeof batchSchema>;

// =============================================================================
// State Machine (defined separately to derive options)
// =============================================================================

const batchStateMachine: StateMachineConfig<Batch> = {
  stateField: "status",
  states: ["planned", "fermenting", "conditioning", "packaging", "completed", "cancelled"],
  initialState: "planned",
  transitions: {
    planned: ["fermenting", "cancelled"],
    fermenting: ["conditioning", "cancelled"],
    conditioning: ["packaging", "cancelled"],
    packaging: ["completed", "cancelled"],
    completed: [],
    cancelled: [],
  },
  stateDisplay: {
    planned: { label: "Planned", color: "default" },
    fermenting: { label: "Fermenting", color: "info" },
    conditioning: { label: "Conditioning", color: "info" },
    packaging: { label: "Packaging", color: "warning" },
    completed: { label: "Completed", color: "success" },
    cancelled: { label: "Cancelled", color: "error" },
  },
};

// Derive status options from state machine (single source of truth)
const statusOptions = statesAsOptions(batchStateMachine);

// =============================================================================
// Entity Configuration
// =============================================================================

export const batchEntity: EntityConfig<Batch> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "batch",
  table: "batches",
  displayName: "Batch",
  displayNamePlural: "Batches",
  description: "Production batches from brewing through packaging",
  domain: "production",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "batch_number",
      header: "Batch #",
      sortable: true,
    },
    {
      accessorKey: "name",
      header: "Name",
      sortable: true,
    },
    {
      accessorKey: "status",
      header: "Status",
      sortable: true,
      render: (value) => (
        <StatusBadge
          status={value as string}
          config={batchEntity.stateMachine?.stateDisplay}
        />
      ),
    },
    {
      accessorKey: "planned_start_date",
      header: "Planned Start",
      sortable: true,
      format: "date",
    },
    {
      accessorKey: "volume_bbl",
      header: "Volume",
      sortable: true,
      format: "unit",
      unitType: "volume",
    },
    {
      accessorKey: "fermenter",
      header: "Fermenter",
      sortable: true,
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

  defaultSort: { column: "planned_start_date", direction: "desc" },
  searchableFields: ["batch_number", "name"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "batch_number",
    subtitle: "name",
    badge: "status",
  },

  detailSections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        { field: "batch_number", label: "Batch Number" },
        { field: "name", label: "Name" },
        { field: "status", label: "Status" },
        { field: "planned_start_date", label: "Planned Start", format: "date" },
        { field: "volume_bbl", label: "Volume", format: "unit", unitType: "volume" },
        { field: "fermenter", label: "Fermenter" },
      ],
    },
    {
      id: "fermentation",
      title: "Fermentation Results",
      fields: [
        { field: "actual_fg", label: "Final Gravity" },
        { field: "actual_abv", label: "ABV %" },
      ],
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
  // Form
  // ---------------------------------------------------------------------------
  formSchema: batchSchema,

  formFields: [
    {
      name: "batch_number",
      label: "Batch Number",
      type: "text",
      placeholder: "e.g., 2024-001",
      required: true,
      colSpan: 6,
    },
    {
      name: "name",
      label: "Name",
      type: "text",
      placeholder: "e.g., Hazy IPA #5",
      required: true,
      colSpan: 6,
    },
    {
      name: "planned_start_date",
      label: "Planned Start Date",
      type: "date",
      description: "When fermentation is planned to start",
      colSpan: 6,
    },
    {
      name: "volume_bbl",
      label: "Volume",
      type: "unit",
      unitType: "volume",
      placeholder: "e.g., 10",
      colSpan: 6,
    },
    {
      name: "fermenter",
      label: "Fermenter",
      type: "text",
      placeholder: "e.g., FV-1",
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
      name: "actual_fg",
      label: "Final Gravity",
      type: "number",
      placeholder: "e.g., 1.012",
      colSpan: 6,
    },
    {
      name: "actual_abv",
      label: "ABV %",
      type: "number",
      placeholder: "e.g., 6.8",
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
  stateMachine: batchStateMachine,

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "start_fermentation",
      label: "Start Fermentation",
      icon: "flask",
      type: "button",
      fromStates: ["planned"],
      toState: "fermenting",
    },
    {
      name: "transfer_to_brite",
      label: "Move to Conditioning",
      icon: "arrow-right",
      type: "button",
      fromStates: ["fermenting"],
      toState: "conditioning",
    },
    {
      name: "start_packaging",
      label: "Start Packaging",
      icon: "package",
      type: "button",
      fromStates: ["conditioning"],
      toState: "packaging",
    },
    {
      name: "complete",
      label: "Complete",
      icon: "check",
      type: "button",
      fromStates: ["packaging"],
      toState: "completed",
    },
    {
      name: "cancel",
      label: "Cancel Batch",
      icon: "x",
      type: "dropdown",
      variant: "destructive",
      fromStates: ["planned", "fermenting", "conditioning", "packaging"],
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
      name: "brew_logs",
      entity: "brew_log",
      type: "hasManyThrough",
      through: "brew_log_batches",
      foreignKey: "batch_id",
      showInDetail: true,
      detailTab: "Brew Logs",
    },
    {
      name: "batch_logs",
      entity: "batch_log",
      type: "hasMany",
      foreignKey: "batch_id",
      showInDetail: true,
      detailTab: "Audit Log",
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show me all batches currently fermenting",
    "What batches are planned for this week?",
    "Which batches are in FV-1?",
    "What's the total volume in fermentation?",
  ],

  keyFields: ["batch_number", "name", "status", "planned_start_date", "fermenter"],
};
