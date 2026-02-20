/**
 * Yeast Pitch Entity Configuration
 *
 * Track individual yeast pitches with brink-based weight tracking.
 * Supports lineage tracking, viability decay, and usage history via pitch events.
 * Weight is tracked in lbs, cell counts in thousands of cells.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";

// Use the view type for computed fields (quantity_remaining_lbs, viability, etc.)
// NOTE: Supabase types must be regenerated after migration to include this view.
type YeastPitch = Database["public"]["Views"]["yeast_pitches_with_remaining"]["Row"];

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
  viewTable: "yeast_pitches_with_remaining",
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
        if (value == null) return "\u2014";
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
      render: (value) => (value != null ? `${value}d` : "\u2014"),
    },
    {
      accessorKey: "quantity_remaining_lbs",
      header: "Remaining (lbs)",
      sortable: true,
      render: (value) => (value != null ? `${Number(value).toFixed(1)}` : "\u2014"),
    },
  ],

  listFilters: [
    {
      field: "status",
      type: "select",
      label: "Status",
      options: STATUS_OPTIONS,
    },
    {
      field: "source_type",
      type: "select",
      label: "Source",
      options: SOURCE_TYPE_OPTIONS,
    },
    {
      field: "strain_name",
      type: "search",
      label: "Strain",
    },
  ],

  defaultSort: { column: "created_at", direction: "desc" },
  searchableFields: ["strain_name", "strain_code", "notes"],

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
      name: "pitch_to_batch",
      label: "Pitch to Batch",
      icon: "flask",
      type: "button" as const,
      fromStates: ["in_stock"],
      // No toState - handled by custom dialog
    },
    {
      name: "record_cell_count",
      label: "Record Cell Count",
      icon: "microscope",
      type: "button" as const,
      fromStates: ["in_stock"],
      // No toState - updates viability fields
    },
    {
      name: "discard",
      label: "Discard",
      icon: "trash",
      type: "dropdown" as const,
      variant: "destructive" as const,
      fromStates: ["in_stock"],
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
      id: "vessel",
      title: "Vessel",
      fields: [
        { field: "vessel_name", label: "Brink" },
      ],
    },
    {
      id: "inventory",
      title: "Inventory",
      fields: [
        { field: "quantity_lbs", label: "Quantity (lbs)", format: "number" },
        { field: "quantity_remaining_lbs", label: "Remaining (lbs)", format: "number" },
        { field: "cell_count_thousand", label: "Cell Count (Thousand)", format: "number" },
        { field: "cell_density_thousand", label: "Cell Density (Thousand/mL)", format: "number" },
        { field: "volume_ml", label: "Volume (mL)", format: "number" },
      ],
    },
    {
      id: "viability",
      title: "Viability",
      fields: [
        { field: "initial_viability", label: "Initial Viability (%)", format: "percentage" },
        { field: "estimated_viability", label: "Current Viability (Est.)", format: "percentage" },
        { field: "viability_status", label: "Viability Status" },
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
      id: "notes",
      title: "Notes",
      fields: [{ field: "notes", label: "Notes", fullWidth: true }],
      collapsible: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Pitch Info",
      fields: [
        {
          name: "strain_id",
          label: "Yeast Strain",
          type: "relation",
          relation: { entity: "yeast", displayField: "name" },
          required: true,
          colSpan: 6,
        },
        { name: "strain_manufacturer", label: "Manufacturer", editable: false, colSpan: 6 },
        { name: "strain_code", label: "Product Code", editable: false, colSpan: 6 },
        {
          name: "source_type",
          label: "Source Type",
          type: "select",
          options: SOURCE_TYPE_OPTIONS,
          required: true,
          colSpan: 4,
        },
        { name: "generation", label: "Generation", editable: false, colSpan: 4 },
        {
          name: "status",
          label: "Status",
          type: "select",
          options: STATUS_OPTIONS,
          colSpan: 4,
        },
      ],
    },
    {
      id: "vessel",
      title: "Vessel",
      fields: [
        {
          name: "vessel_id",
          label: "Brink",
          type: "relation",
          relation: { entity: "vessel", displayField: "name" },
          colSpan: 6,
        },
        { name: "vessel_name", label: "Brink", editable: false, colSpan: 6 },
      ],
    },
    {
      id: "inventory",
      title: "Inventory",
      fields: [
        {
          name: "quantity_lbs",
          label: "Quantity (lbs)",
          type: "number",
          format: "number",
          placeholder: "e.g., 30",
          description: "Weight of yeast slurry in pounds",
          colSpan: 4,
        },
        { name: "quantity_remaining_lbs", label: "Remaining (lbs)", format: "number", editable: false, colSpan: 4 },
        {
          name: "cell_count_thousand",
          label: "Cell Count (Thousand)",
          type: "number",
          format: "number",
          placeholder: "e.g., 200000",
          description: "Estimated cells in thousands",
          colSpan: 4,
        },
        {
          name: "cell_density_thousand",
          label: "Cell Density (Thousand/mL)",
          type: "number",
          format: "number",
          placeholder: "e.g., 1000",
          description: "Cells per mL in thousands",
          colSpan: 4,
        },
        {
          name: "volume_ml",
          label: "Volume (mL)",
          type: "number",
          format: "number",
          placeholder: "e.g., 100",
          description: "Volume for liquid purchases",
          colSpan: 4,
        },
      ],
    },
    {
      id: "viability",
      title: "Viability",
      fields: [
        {
          name: "initial_viability",
          label: "Initial Viability (%)",
          type: "number",
          format: "percentage",
          placeholder: "95",
          description: "Viability at time of receipt/harvest",
          colSpan: 4,
        },
        { name: "estimated_viability", label: "Current Viability (Est.)", format: "percentage", editable: false, colSpan: 4 },
        { name: "viability_status", label: "Viability Status", editable: false, colSpan: 4 },
        { name: "days_old", label: "Days Old", format: "number", editable: false, colSpan: 4 },
      ],
    },
    {
      id: "dates",
      title: "Dates",
      fields: [
        {
          name: "received_date",
          label: "Received",
          type: "date",
          format: "date",
          description: "When purchased/received",
          colSpan: 4,
        },
        {
          name: "harvest_date",
          label: "Harvested",
          type: "date",
          format: "date",
          description: "When harvested (for harvest source)",
          colSpan: 4,
        },
        {
          name: "use_by_date",
          label: "Use By",
          type: "date",
          format: "date",
          colSpan: 4,
        },
      ],
    },
    {
      id: "cost",
      title: "Cost",
      fields: [
        {
          name: "cost",
          label: "Purchase Cost ($)",
          type: "number",
          format: "currency",
          placeholder: "e.g., 12.00",
          description: "Cost for purchased yeast",
          colSpan: 6,
        },
        { name: "cost_per_batch", label: "Cost Per Batch", format: "currency", editable: false, colSpan: 6 },
      ],
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
          placeholder: "Any observations about this pitch...",
          fullWidth: true,
          colSpan: 12,
        },
      ],
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
      relation: { entity: "yeast", displayField: "name" },
      required: true,
      colSpan: 6,
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
        table: "yeast_pitches_with_remaining",
        labelField: "strain_name",
        valueField: "id",
        filter: { status: "in_use" },
      },
      description: "Select parent pitch when recording a harvest",
    },
    {
      name: "vessel_id",
      label: "Brink",
      type: "relation",
      relation: { entity: "vessel", displayField: "name" },
      colSpan: 6,
    },
    {
      name: "quantity_lbs",
      label: "Quantity (lbs)",
      type: "number",
      placeholder: "e.g., 30",
      description: "Weight of yeast slurry in pounds",
      colSpan: 4,
    },
    {
      name: "volume_ml",
      label: "Volume (mL)",
      type: "number",
      placeholder: "e.g., 100",
      description: "Volume for liquid purchases",
      colSpan: 4,
    },
    {
      name: "cell_count_thousand",
      label: "Cell Count (Thousand)",
      type: "number",
      placeholder: "e.g., 200000",
      description: "Estimated cells in thousands",
      colSpan: 4,
    },
    {
      name: "cell_density_thousand",
      label: "Cell Density (Thousand/mL)",
      type: "number",
      placeholder: "e.g., 1000",
      description: "Cells per mL in thousands",
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
      type: "relation",
      relation: { entity: "location", displayField: "name" },
      colSpan: 6,
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
    {
      name: "pitch_events",
      entity: "yeast_pitch_event",
      type: "hasMany",
      foreignKey: "pitch_id",
      showInDetail: true,
      detailTab: "Usage History",
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
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
