/**
 * Vessel Entity Configuration
 *
 * Vessels are the physical containers used in the brewing process:
 * fermenters, brites, kettles, mash tuns, HLTs, and unitanks.
 *
 * State machine tracks the cleaning workflow:
 * dirty → caustic_cleaned → ready_for_use → in_use → dirty
 * Plus maintenance as escape hatch from any state.
 *
 * The current_batch_id tracks what batch is currently occupying the vessel.
 */

import { z } from "zod";
import type { EntityConfig, StateMachineConfig, ValueDisplayConfig } from "@/types/entity";
import { statesAsOptions, valuesAsOptions, getValueLabel } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { StatusBadge } from "@/components/universal/status-badge";
import { Badge } from "@/components/ui/badge";
import { VesselCurrentBatch } from "@/components/domain/vessel-current-batch";

// Base type from vessels table
type Vessel = Database["public"]["Tables"]["vessels"]["Row"];

// Extended type for list view (includes batch info from vessels_with_batch view)
type VesselWithBatch = Database["public"]["Views"]["vessels_with_batch"]["Row"];

// =============================================================================
// Value Display Configuration
// =============================================================================

const vesselTypeDisplayConfig: ValueDisplayConfig = {
  field: "vessel_type",
  display: {
    fermenter: { label: "Fermenter" },
    brite: { label: "Brite Tank" },
    kettle: { label: "Kettle" },
    mash_tun: { label: "Mash Tun" },
    hlt: { label: "HLT" },
    unitank: { label: "Unitank" },
    foeder: { label: "Foeder" },
    barrel: { label: "Barrel" },
  },
};

// Vessel type values for type extraction
export const VESSEL_TYPES = [
  { value: "fermenter", label: "Fermenter" },
  { value: "brite", label: "Brite Tank" },
  { value: "kettle", label: "Kettle" },
  { value: "mash_tun", label: "Mash Tun" },
  { value: "hlt", label: "HLT" },
  { value: "unitank", label: "Unitank" },
  { value: "foeder", label: "Foeder" },
  { value: "barrel", label: "Barrel" },
] as const;

export type VesselType = (typeof VESSEL_TYPES)[number]["value"];

// =============================================================================
// Zod Schema
// =============================================================================

export const vesselSchema = z.object({
  name: z.string().min(1, "Name is required"),
  vessel_type: z.enum([
    "fermenter",
    "brite",
    "kettle",
    "mash_tun",
    "hlt",
    "unitank",
    "foeder",
    "barrel",
  ]),
  capacity_bbl: z.coerce.number().min(0, "Capacity must be positive"),
  location_id: z.string().uuid().nullable().optional(),
  status: z.enum(["dirty", "caustic_cleaned", "ready_for_use", "in_use", "maintenance"]).default("ready_for_use"),
  current_batch_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
});

export type VesselFormValues = z.infer<typeof vesselSchema>;

// =============================================================================
// State Machine
// =============================================================================

const vesselStateMachine: StateMachineConfig<Vessel> = {
  stateField: "status",
  states: ["dirty", "caustic_cleaned", "ready_for_use", "in_use", "maintenance"],
  initialState: "ready_for_use",
  transitions: {
    dirty: ["caustic_cleaned", "ready_for_use", "maintenance"],
    caustic_cleaned: ["ready_for_use", "maintenance"],
    ready_for_use: ["in_use", "maintenance"],
    in_use: ["dirty", "maintenance"],
    maintenance: ["dirty"],
  },
  stateDisplay: {
    dirty: { label: "Dirty", color: "warning" },
    caustic_cleaned: { label: "Caustic Cleaned", color: "info" },
    ready_for_use: { label: "Ready", color: "success" },
    in_use: { label: "In Use", color: "default" },
    maintenance: { label: "Maintenance", color: "error" },
  },
};

// Derive status options from state machine
const statusOptions = statesAsOptions(vesselStateMachine);

// Vessel type options - derived from valueDisplay config
const vesselTypeOptions = valuesAsOptions(vesselTypeDisplayConfig);

// =============================================================================
// Entity Configuration
// =============================================================================

export const vesselEntity: EntityConfig<Vessel> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "vessel",
  table: "vessels",
  displayName: "Vessel",
  displayNamePlural: "Vessels",
  description: "Brewing vessels including fermenters, brites, kettles, and more",
  domain: "production",
  viewTable: "vessels_with_batch",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "name",
      header: "Name",
      sortable: true,
    },
    {
      accessorKey: "vessel_type",
      header: "Type",
      sortable: true,
      render: (value) => (
        <Badge variant="outline">
          {getValueLabel(vesselEntity, "vessel_type", value as string)}
        </Badge>
      ),
    },
    {
      accessorKey: "capacity_bbl",
      header: "Capacity",
      sortable: true,
      format: "unit",
      unitType: "volume",
    },
    {
      accessorKey: "status",
      header: "Status",
      sortable: true,
      render: (value) => (
        <StatusBadge
          status={value as string}
          config={vesselEntity.stateMachine?.stateDisplay}
        />
      ),
    },
    {
      accessorKey: "current_batch_id",
      header: "Current Batch",
      sortable: false,
      render: (_value, row) => {
        const viewRow = row as unknown as VesselWithBatch;
        if (!viewRow.batch_name && !viewRow.batch_number) {
          return <span className="text-muted-foreground">Empty</span>;
        }
        return (
          <span className="font-medium">
            {viewRow.batch_number || viewRow.batch_name}
          </span>
        );
      },
    },
    {
      accessorKey: "is_active",
      header: "Active",
      sortable: true,
      render: (value) => value ? "Yes" : "No",
    },
  ],

  listFilters: [
    {
      field: "vessel_type",
      type: "multiselect",
      label: "Type",
      options: vesselTypeOptions,
    },
    {
      field: "status",
      type: "multiselect",
      label: "Status",
      options: statusOptions,
    },
    {
      field: "is_active",
      type: "boolean",
      label: "Active",
    },
  ],

  defaultSort: { column: "name", direction: "asc" },
  searchableFields: ["name"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "name",
    badge: "status",
  },

  detailSections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        { field: "name", label: "Name" },
        { field: "vessel_type", label: "Type" },
        { field: "capacity_bbl", label: "Capacity", format: "unit", unitType: "volume" },
        { field: "status", label: "Status" },
        { field: "is_active", label: "Active" },
      ],
    },
    {
      id: "current_batch",
      title: "Current Batch",
      component: VesselCurrentBatch,
    },
    {
      id: "location",
      title: "Location",
      fields: [
        { field: "location_id", label: "Location" },
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
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        {
          name: "name",
          label: "Name",
          type: "text",
          placeholder: "e.g., FV-1, Brite-A",
          required: true,
          colSpan: 6,
        },
        {
          name: "vessel_type",
          label: "Type",
          type: "select",
          options: vesselTypeOptions,
          required: true,
          colSpan: 6,
        },
        {
          name: "capacity_bbl",
          label: "Capacity",
          type: "unit",
          unitType: "volume",
          format: "unit",
          placeholder: "e.g., 7",
          required: true,
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
          name: "is_active",
          label: "Active",
          type: "switch",
          defaultValue: true,
          colSpan: 6,
        },
      ],
    },
    {
      id: "current_batch",
      title: "Current Batch",
      component: VesselCurrentBatch,
    },
    {
      id: "location",
      title: "Location",
      fields: [
        {
          name: "location_id",
          label: "Location",
          type: "relation",
          relation: {
            entity: "location",
            displayField: "name",
          },
          colSpan: 6,
        },
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
          placeholder: "Any special notes about this vessel...",
          fullWidth: true,
          colSpan: 12,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: vesselSchema,

  formFields: [
    {
      name: "name",
      label: "Name",
      type: "text",
      placeholder: "e.g., FV-1, Brite-A",
      required: true,
      colSpan: 6,
    },
    {
      name: "vessel_type",
      label: "Type",
      type: "select",
      options: vesselTypeOptions,
      required: true,
      colSpan: 6,
    },
    {
      name: "capacity_bbl",
      label: "Capacity",
      type: "unit",
      unitType: "volume",
      placeholder: "e.g., 7",
      required: true,
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
      name: "location_id",
      label: "Location",
      type: "relation",
      relation: {
        entity: "location",
        displayField: "name",
      },
      colSpan: 6,
    },
    {
      name: "is_active",
      label: "Active",
      type: "switch",
      defaultValue: true,
      colSpan: 6,
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      placeholder: "Any special notes about this vessel...",
      colSpan: 12,
    },
  ],

  // ---------------------------------------------------------------------------
  // State Machine
  // ---------------------------------------------------------------------------
  stateMachine: vesselStateMachine,

  // ---------------------------------------------------------------------------
  // Value Display
  // ---------------------------------------------------------------------------
  valueDisplay: [vesselTypeDisplayConfig],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "start_cleaning",
      label: "Start Cleaning",
      icon: "spray-can",
      type: "button",
      fromStates: ["dirty"],
      toState: "caustic_cleaned",
    },
    {
      name: "mark_ready",
      label: "Mark Ready",
      icon: "check",
      type: "button",
      fromStates: ["caustic_cleaned", "dirty"],
      toState: "ready_for_use",
    },
    {
      name: "assign_batch",
      label: "Assign Batch",
      icon: "plus",
      type: "button",
      fromStates: ["ready_for_use"],
      toState: "in_use",
    },
    {
      name: "empty_vessel",
      label: "Empty Vessel",
      icon: "arrow-right",
      type: "button",
      fromStates: ["in_use"],
      toState: "dirty",
    },
    {
      name: "start_maintenance",
      label: "Start Maintenance",
      icon: "wrench",
      type: "dropdown",
      variant: "destructive",
      fromStates: ["dirty", "caustic_cleaned", "ready_for_use", "in_use"],
      toState: "maintenance",
      confirm: true,
    },
    {
      name: "end_maintenance",
      label: "End Maintenance",
      icon: "check",
      type: "button",
      fromStates: ["maintenance"],
      toState: "dirty",
    },
    {
      name: "delete",
      label: "Delete Vessel",
      icon: "trash",
      type: "dropdown",
      variant: "destructive",
      deleteMode: "hard" as const,
    },
  ],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "location",
      entity: "location",
      type: "belongsTo",
      foreignKey: "location_id",
      showInDetail: true,
    },
    {
      name: "current_batch",
      entity: "batch",
      type: "belongsTo",
      foreignKey: "current_batch_id",
      showInDetail: true,
    },
    {
      name: "transfers_to",
      entity: "vessel_transfer",
      type: "hasMany",
      foreignKey: "to_vessel_id",
      showInDetail: true,
      detailTab: "Transfer History",
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show me all available fermenters",
    "Which vessels are currently in use?",
    "What's in FV-1?",
    "List dirty vessels that need cleaning",
    "Find vessels under maintenance",
    "What's the total fermenter capacity?",
  ],

  keyFields: ["name", "vessel_type", "capacity_bbl", "status"],
};
