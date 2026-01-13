/**
 * Yeast Pitch Entity Configuration
 *
 * Tracks yeast pitches with lineage, viability decay, and cost spreading.
 * Supports both purchased yeast and harvested yeast from previous batches.
 */

import { z } from "zod";
import type { EntityConfig, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

// Temporary type until migration is applied and types regenerated
type YeastPitch = {
  id: string;
  strain_id: string;
  source_type: "purchase" | "harvest";
  parent_pitch_id: string | null;
  generation: number;
  cell_count_billions: number | null;
  viability_percent: number | null;
  harvest_date: string | null;
  received_date: string | null;
  pitched_date: string | null;
  cost: number | null;
  status: "available" | "pitched" | "discarded";
  batch_id: string | null;
  source_batch_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // From view
  strain_name?: string;
  strain_manufacturer?: string;
  batch_number?: string;
  source_batch_number?: string;
  current_viability_percent?: number;
  days_since_harvest?: number;
};

// =============================================================================
// Zod Schema
// =============================================================================

export const yeastPitchSchema = z.object({
  strain_id: z.string().uuid("Yeast strain is required"),
  source_type: z.enum(["purchase", "harvest"]),
  parent_pitch_id: z.string().uuid().nullable().optional(),
  generation: z.coerce.number().int().min(1).default(1),
  cell_count_billions: z.coerce.number().nullable().optional(),
  viability_percent: z.coerce.number().min(0).max(100).nullable().optional(),
  harvest_date: z.string().nullable().optional(),
  received_date: z.string().nullable().optional(),
  cost: z.coerce.number().nullable().optional(),
  status: z.enum(["available", "pitched", "discarded"]).default("available"),
  batch_id: z.string().uuid().nullable().optional(),
  source_batch_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type YeastPitchFormValues = z.infer<typeof yeastPitchSchema>;

// =============================================================================
// State Machine
// =============================================================================

const yeastPitchStateMachine: StateMachineConfig<YeastPitch> = {
  stateField: "status",
  states: ["available", "pitched", "discarded"],
  initialState: "available",
  transitions: {
    available: ["pitched", "discarded"],
    pitched: [], // Terminal state
    discarded: [], // Terminal state
  },
  stateDisplay: {
    available: { label: "Available", color: "success" },
    pitched: { label: "Pitched", color: "info" },
    discarded: { label: "Discarded", color: "error" },
  },
};

const statusOptions = statesAsOptions(yeastPitchStateMachine);

// =============================================================================
// Entity Configuration
// =============================================================================

export const yeastPitchEntity: EntityConfig<YeastPitch> = {
  name: "yeast_pitch",
  table: "yeast_pitches",
  viewTable: "yeast_pitches_with_viability",
  displayName: "Yeast Pitch",
  displayNamePlural: "Yeast Pitches",
  description: "Yeast pitch tracking with lineage and viability",
  domain: "production",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "strain_name",
      header: "Strain",
      sortable: true,
    },
    {
      accessorKey: "source_type",
      header: "Source",
      render: (value) => (
        <Badge variant={value === "purchase" ? "default" : "secondary"}>
          {value === "purchase" ? "Purchased" : "Harvested"}
        </Badge>
      ),
    },
    {
      accessorKey: "generation",
      header: "Gen",
      sortable: true,
    },
    {
      accessorKey: "current_viability_percent",
      header: "Viability",
      sortable: true,
      render: (value) => {
        if (value == null) return "—";
        const v = value as number;
        let color = "text-success";
        if (v < 75) color = "text-warning";
        if (v < 50) color = "text-destructive";
        return <span className={color}>{v.toFixed(1)}%</span>;
      },
    },
    {
      accessorKey: "cell_count_billions",
      header: "Cells (B)",
      sortable: true,
      render: (value) => value != null ? `${value}B` : "—",
    },
    {
      accessorKey: "status",
      header: "Status",
      sortable: true,
      render: (value) => {
        const config = yeastPitchStateMachine.stateDisplay?.[value as string];
        return (
          <Badge
            variant={
              config?.color === "success"
                ? "default"
                : config?.color === "info"
                ? "secondary"
                : "destructive"
            }
          >
            {config?.label || String(value)}
          </Badge>
        );
      },
    },
    {
      accessorKey: "harvest_date",
      header: "Harvest Date",
      sortable: true,
      format: "date",
    },
  ],

  listFilters: [
    {
      field: "status",
      type: "multiselect",
      label: "Status",
      options: statusOptions,
    },
    {
      field: "source_type",
      type: "select",
      label: "Source",
      options: [
        { value: "purchase", label: "Purchased" },
        { value: "harvest", label: "Harvested" },
      ],
    },
  ],

  defaultSort: { column: "harvest_date", direction: "desc" },
  searchableFields: [],

  // ---------------------------------------------------------------------------
  // State Machine
  // ---------------------------------------------------------------------------
  stateMachine: yeastPitchStateMachine,

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "strain_name",
    subtitle: "source_type",
    badge: "status",
  },

  detailSections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        { field: "strain_name", label: "Strain" },
        { field: "strain_manufacturer", label: "Manufacturer" },
        { field: "source_type", label: "Source Type" },
        { field: "generation", label: "Generation" },
        { field: "status", label: "Status" },
      ],
    },
    {
      id: "viability",
      title: "Cell Count & Viability",
      fields: [
        { field: "cell_count_billions", label: "Cell Count (Billions)" },
        { field: "viability_percent", label: "Initial Viability %" },
        { field: "current_viability_percent", label: "Current Viability %" },
        { field: "days_since_harvest", label: "Days Since Harvest" },
      ],
    },
    {
      id: "dates",
      title: "Dates",
      fields: [
        { field: "harvest_date", label: "Harvest Date", format: "date" },
        { field: "received_date", label: "Received Date", format: "date" },
        { field: "pitched_date", label: "Pitched Date", format: "date" },
      ],
    },
    {
      id: "batch_info",
      title: "Batch Information",
      fields: [
        { field: "batch_number", label: "Pitched Into" },
        { field: "source_batch_number", label: "Harvested From" },
      ],
    },
    {
      id: "cost",
      title: "Cost",
      fields: [{ field: "cost", label: "Cost", format: "currency" }],
    },
    {
      id: "notes",
      title: "Notes",
      fields: [{ field: "notes", label: "Notes", fullWidth: true }],
      collapsible: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: yeastPitchSchema,

  formFields: [
    {
      name: "strain_id",
      label: "Yeast Strain",
      type: "relation",
      required: true,
      colSpan: 6,
      relation: {
        entity: "yeast",
        displayField: "name",
      },
    },
    {
      name: "source_type",
      label: "Source Type",
      type: "select",
      required: true,
      colSpan: 6,
      options: [
        { value: "purchase", label: "Purchased" },
        { value: "harvest", label: "Harvested" },
      ],
    },
    {
      name: "generation",
      label: "Generation",
      type: "number",
      colSpan: 4,
      description: "1 = original, 2+ = propagated",
    },
    {
      name: "cell_count_billions",
      label: "Cell Count (Billions)",
      type: "number",
      colSpan: 4,
      placeholder: "e.g., 100",
    },
    {
      name: "viability_percent",
      label: "Viability %",
      type: "number",
      colSpan: 4,
      placeholder: "e.g., 95",
    },
    {
      name: "harvest_date",
      label: "Harvest Date",
      type: "date",
      colSpan: 4,
    },
    {
      name: "received_date",
      label: "Received Date",
      type: "date",
      colSpan: 4,
    },
    {
      name: "cost",
      label: "Cost",
      type: "number",
      colSpan: 4,
      placeholder: "0.00",
    },
    {
      name: "source_batch_id",
      label: "Harvested From Batch",
      type: "relation",
      colSpan: 6,
      relation: {
        entity: "batch",
        displayField: "batch_number",
      },
      showWhen: (values) => values.source_type === "harvest",
    },
    {
      name: "parent_pitch_id",
      label: "Parent Pitch",
      type: "relation",
      colSpan: 6,
      relation: {
        entity: "yeast_pitch",
        displayField: "id",
      },
      description: "Previous generation pitch this was propagated from",
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      colSpan: 12,
      placeholder: "Storage conditions, observations...",
    },
  ],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "pitch",
      label: "Record Pitch",
      icon: "Beaker",
      type: "button",
      variant: "default",
      fromStates: ["available"],
      toState: "pitched",
      dialog: "pitch",
    },
    {
      name: "discard",
      label: "Discard",
      icon: "Trash2",
      type: "button",
      variant: "destructive",
      fromStates: ["available"],
      toState: "discarded",
      confirm: true,
    },
    {
      name: "harvest",
      label: "Record Harvest",
      icon: "FlaskConical",
      type: "button",
      variant: "outline",
      fromStates: ["pitched"],
      dialog: "harvest",
    },
  ],

  // ---------------------------------------------------------------------------
  // Dialogs
  // ---------------------------------------------------------------------------
  dialogs: {
    pitch: {
      title: "Record Pitch",
      description: "Record pitching this yeast into a batch.",
      fields: [
        {
          name: "batch_id",
          label: "Batch",
          type: "relation",
          required: true,
          colSpan: 12,
          relation: {
            entity: "batch",
            displayField: "batch_number",
          },
        },
        {
          name: "pitched_date",
          label: "Pitch Date",
          type: "date",
          colSpan: 12,
        },
      ],
    },
    harvest: {
      title: "Record Harvest",
      description: "Create a new pitch from harvested yeast.",
      fields: [
        {
          name: "cell_count_billions",
          label: "Estimated Cell Count (Billions)",
          type: "number",
          colSpan: 6,
        },
        {
          name: "viability_percent",
          label: "Estimated Viability %",
          type: "number",
          colSpan: 6,
        },
        {
          name: "notes",
          label: "Notes",
          type: "textarea",
          colSpan: 12,
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "strain",
      entity: "yeast",
      type: "belongsTo",
      foreignKey: "strain_id",
    },
    {
      name: "batch",
      entity: "batch",
      type: "belongsTo",
      foreignKey: "batch_id",
    },
    {
      name: "source_batch",
      entity: "batch",
      type: "belongsTo",
      foreignKey: "source_batch_id",
    },
    {
      name: "parent_pitch",
      entity: "yeast_pitch",
      type: "belongsTo",
      foreignKey: "parent_pitch_id",
    },
    {
      name: "child_pitches",
      entity: "yeast_pitch",
      type: "hasMany",
      foreignKey: "parent_pitch_id",
      showInDetail: true,
      detailTab: "Lineage",
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "List available yeast pitches",
    "Show pitches with viability below 80%",
    "Get lineage for a pitch",
    "Find pitches from strain US-05",
    "Show harvested yeast from batch 2024-001",
  ],

  keyFields: [
    "strain_id",
    "generation",
    "viability_percent",
    "cell_count_billions",
    "status",
  ],
};
