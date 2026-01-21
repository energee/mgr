/**
 * Yeast Pitch Entity Configuration
 *
 * Track individual yeast pitches from purchase through repitching.
 * Supports lineage tracking for generation counting and cost spreading.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";

// Type definition for yeast pitch with view details
// Note: Table is new and not in generated types yet
interface YeastPitch {
  id: string;
  strain_id: string;
  source_type: "purchase" | "harvest";
  parent_pitch_id: string | null;
  generation: number;
  status: "in_stock" | "in_use" | "harvested" | "depleted" | "discarded";
  volume_ml: number | null;
  cell_count_billion: number | null;
  initial_viability: number | null;
  current_viability: number | null;
  cost: number | null;
  cost_per_batch: number | null;
  received_date: string | null;
  harvest_date: string | null;
  use_by_date: string | null;
  batch_id: string | null;
  pitched_at: string | null;
  location_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  // View fields
  strain_name?: string;
  strain_manufacturer?: string;
  strain_code?: string;
  strain_type?: string;
  strain_form?: string;
  strain_attenuation?: number;
  location_name?: string;
  batch_number?: string;
  batch_name?: string;
  days_old?: number;
  estimated_viability?: number;
  viability_status?: "excellent" | "good" | "marginal" | "low" | "inactive";
}

// =============================================================================
// Zod Schema
// =============================================================================

export const yeastPitchSchema = z.object({
  strain_id: z.string().uuid("Select a yeast strain"),
  source_type: z.enum(["purchase", "harvest"]),
  parent_pitch_id: z.string().uuid().nullable().optional(),
  status: z.enum(["in_stock", "in_use", "harvested", "depleted", "discarded"]).default("in_stock"),
  volume_ml: z.coerce.number().min(0).nullable().optional(),
  cell_count_billion: z.coerce.number().min(0).nullable().optional(),
  initial_viability: z.coerce.number().min(0).max(100).default(95).nullable().optional(),
  cost: z.coerce.number().min(0).nullable().optional(),
  received_date: z.string().nullable().optional(),
  harvest_date: z.string().nullable().optional(),
  use_by_date: z.string().nullable().optional(),
  batch_id: z.string().uuid().nullable().optional(),
  location_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type YeastPitchFormValues = z.infer<typeof yeastPitchSchema>;

// =============================================================================
// Constants
// =============================================================================

const SOURCE_TYPE_OPTIONS = [
  { value: "purchase", label: "Purchase" },
  { value: "harvest", label: "Harvest" },
];

const STATUS_OPTIONS = [
  { value: "in_stock", label: "In Stock" },
  { value: "in_use", label: "In Use" },
  { value: "harvested", label: "Harvested" },
  { value: "depleted", label: "Depleted" },
  { value: "discarded", label: "Discarded" },
];

const STATUS_DISPLAY: Record<string, { label: string; color: "error" | "default" | "success" | "warning" | "info" }> = {
  in_stock: { label: "In Stock", color: "success" },
  in_use: { label: "In Use", color: "info" },
  harvested: { label: "Harvested", color: "default" },
  depleted: { label: "Depleted", color: "warning" },
  discarded: { label: "Discarded", color: "error" },
};

const VIABILITY_STATUS_DISPLAY: Record<string, { label: string; color: "default" | "secondary" | "destructive" | "outline" }> = {
  excellent: { label: "Excellent", color: "default" },
  good: { label: "Good", color: "secondary" },
  marginal: { label: "Marginal", color: "outline" },
  low: { label: "Low", color: "destructive" },
  inactive: { label: "Inactive", color: "outline" },
};

// =============================================================================
// Entity Configuration
// =============================================================================

export const yeastPitchEntity: EntityConfig<YeastPitch> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "yeast_pitch",
  table: "yeast_pitches",
  viewTable: "yeast_pitches_with_details",
  displayName: "Yeast Pitch",
  displayNamePlural: "Yeast Pitches",
  description: "Individual yeast pitches tracking lineage, viability, and usage",
  domain: "production",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "strain_name",
      header: "Strain",
      sortable: true,
      render: (value, row) => {
        const pitch = row as YeastPitch;
        return (
          <div>
            <span className="font-medium">{String(value || "Unknown")}</span>
            {pitch.strain_code && (
              <span className="text-muted-foreground ml-1 text-sm">({pitch.strain_code})</span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "source_type",
      header: "Source",
      sortable: true,
      render: (value) => {
        const option = SOURCE_TYPE_OPTIONS.find((o) => o.value === value);
        return option?.label || String(value);
      },
    },
    {
      accessorKey: "generation",
      header: "Gen",
      sortable: true,
      render: (value) => `G${value || 1}`,
    },
    {
      accessorKey: "status",
      header: "Status",
      sortable: true,
    },
    {
      accessorKey: "estimated_viability",
      header: "Viability",
      sortable: true,
      render: (value, row) => {
        const pitch = row as YeastPitch;
        if (value == null) return "—";
        const status = pitch.viability_status || "good";
        const color = VIABILITY_STATUS_DISPLAY[status]?.color || "default";
        return (
          <span className={color === "destructive" ? "text-destructive" : color === "secondary" ? "text-muted-foreground" : ""}>
            {Math.round(Number(value))}%
          </span>
        );
      },
    },
    {
      accessorKey: "days_old",
      header: "Age",
      sortable: true,
      render: (value) => (value != null ? `${value}d` : "—"),
    },
    {
      accessorKey: "batch_name",
      header: "Batch",
      sortable: true,
      render: (value, row) => {
        const pitch = row as YeastPitch;
        if (pitch.batch_id && value) {
          return String(value);
        }
        return "—";
      },
    },
  ],

  listFilters: [
    {
      field: "status",
      type: "select",
      label: "Status",
      options: [{ value: "", label: "All Statuses" }, ...STATUS_OPTIONS],
    },
    {
      field: "source_type",
      type: "select",
      label: "Source",
      options: [{ value: "", label: "All Sources" }, ...SOURCE_TYPE_OPTIONS],
    },
    {
      field: "strain_name",
      type: "search",
      label: "Strain",
    },
  ],

  defaultSort: { column: "created_at", direction: "desc" },
  searchableFields: ["strain_name", "strain_code", "notes", "batch_name"],

  // ---------------------------------------------------------------------------
  // State Machine
  // ---------------------------------------------------------------------------
  stateMachine: {
    stateField: "status",
    initialState: "in_stock",
    states: ["in_stock", "in_use", "harvested", "depleted", "discarded"],
    transitions: {
      in_stock: ["in_use", "discarded"],
      in_use: ["harvested", "depleted", "discarded"],
      harvested: [],  // Terminal - new pitch created from harvest
      depleted: [],    // Terminal
      discarded: [],   // Terminal
    },
    stateDisplay: STATUS_DISPLAY,
  },

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "use",
      label: "Use for Batch",
      icon: "flask",
      type: "button",
      fromStates: ["in_stock"],
      toState: "in_use",
    },
    {
      name: "harvest",
      label: "Harvest Yeast",
      icon: "download",
      type: "button",
      fromStates: ["in_use"],
      // No toState - handled by custom action handler
    },
    {
      name: "mark_depleted",
      label: "Mark Depleted",
      icon: "x",
      type: "button",
      fromStates: ["in_use"],
      toState: "depleted",
    },
    {
      name: "discard",
      label: "Discard",
      icon: "trash",
      type: "button",
      fromStates: ["in_stock", "in_use"],
      toState: "discarded",
    },
  ],

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
      title: "Pitch Info",
      fields: [
        { field: "strain_name", label: "Strain" },
        { field: "strain_manufacturer", label: "Manufacturer" },
        { field: "strain_code", label: "Product Code" },
        { field: "source_type", label: "Source" },
        { field: "generation", label: "Generation" },
        { field: "status", label: "Status" },
      ],
    },
    {
      id: "viability",
      title: "Viability & Quantity",
      fields: [
        { field: "initial_viability", label: "Initial Viability (%)", format: "percentage" },
        { field: "estimated_viability", label: "Current Viability (Est.)", format: "percentage" },
        { field: "viability_status", label: "Viability Status" },
        { field: "volume_ml", label: "Volume (mL)", format: "number" },
        { field: "cell_count_billion", label: "Cell Count (Billion)", format: "number" },
        { field: "days_old", label: "Days Old", format: "number" },
      ],
    },
    {
      id: "dates",
      title: "Dates",
      fields: [
        { field: "received_date", label: "Received", format: "date" },
        { field: "harvest_date", label: "Harvested", format: "date" },
        { field: "use_by_date", label: "Use By", format: "date" },
        { field: "pitched_at", label: "Pitched", format: "datetime" },
      ],
    },
    {
      id: "cost",
      title: "Cost",
      fields: [
        { field: "cost", label: "Purchase Cost", format: "currency" },
        { field: "cost_per_batch", label: "Cost Per Batch", format: "currency" },
      ],
    },
    {
      id: "usage",
      title: "Usage",
      fields: [
        { field: "batch_name", label: "Batch" },
        { field: "batch_number", label: "Batch Number" },
        { field: "location_name", label: "Storage Location" },
      ],
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
      type: "select",
      required: true,
      colSpan: 6,
      dynamicOptions: {
        table: "yeasts",
        labelField: "name",
        valueField: "id",
        filter: { is_active: true },
      },
    },
    {
      name: "source_type",
      label: "Source Type",
      type: "select",
      options: SOURCE_TYPE_OPTIONS,
      required: true,
      colSpan: 3,
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      options: STATUS_OPTIONS,
      colSpan: 3,
    },
    {
      name: "parent_pitch_id",
      label: "Parent Pitch (for harvest)",
      type: "select",
      colSpan: 6,
      dynamicOptions: {
        table: "yeast_pitches_with_details",
        labelField: "strain_name",
        valueField: "id",
        filter: { status: "in_use" },
      },
      description: "Select parent pitch when recording a harvest",
    },
    {
      name: "batch_id",
      label: "Pitched Into Batch",
      type: "select",
      colSpan: 6,
      dynamicOptions: {
        table: "batches",
        labelField: "name",
        valueField: "id",
        orderBy: "created_at",
      },
      description: "Batch this pitch was used for (if already pitched)",
    },
    {
      name: "volume_ml",
      label: "Volume (mL)",
      type: "number",
      placeholder: "e.g., 100",
      colSpan: 4,
    },
    {
      name: "cell_count_billion",
      label: "Cell Count (Billion)",
      type: "number",
      placeholder: "e.g., 200",
      description: "Estimated billion cells",
      colSpan: 4,
    },
    {
      name: "initial_viability",
      label: "Initial Viability (%)",
      type: "number",
      placeholder: "95",
      description: "Viability at time of receipt/harvest",
      colSpan: 4,
    },
    {
      name: "received_date",
      label: "Received Date",
      type: "date",
      colSpan: 4,
      description: "When purchased/received",
    },
    {
      name: "harvest_date",
      label: "Harvest Date",
      type: "date",
      colSpan: 4,
      description: "When harvested (for harvest source)",
    },
    {
      name: "use_by_date",
      label: "Use By Date",
      type: "date",
      colSpan: 4,
    },
    {
      name: "cost",
      label: "Purchase Cost ($)",
      type: "number",
      placeholder: "e.g., 12.00",
      description: "Cost for purchased yeast",
      colSpan: 6,
    },
    {
      name: "location_id",
      label: "Storage Location",
      type: "select",
      colSpan: 6,
      dynamicOptions: {
        table: "locations",
        labelField: "name",
        valueField: "id",
        filter: { field: "is_active", value: true },
      },
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      placeholder: "Any observations about this pitch...",
      colSpan: 12,
    },
  ],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "Children",
      entity: "yeast_pitch",
      type: "hasMany",
      foreignKey: "parent_pitch_id",
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show available yeast pitches",
    "What's the viability of our lager yeast?",
    "List pitches from WLP001",
    "Show yeast in use",
    "Find pitches ready to harvest",
    "What generation is our house yeast at?",
  ],

  keyFields: ["strain_id", "source_type", "status", "generation", "estimated_viability", "batch_id"],
};
