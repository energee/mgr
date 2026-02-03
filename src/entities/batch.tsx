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

import type { EntityConfig, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { StatusBadge } from "@/components/universal/status-badge";
import { BatchQuickLinks } from "@/components/domain/batch-quick-links";
import { BatchBrewInfo } from "@/components/domain/batch-brew-info";
import { BatchCancellationInfo } from "@/components/domain/batch-cancellation-info";
import { BatchInsights } from "@/components/domain/batch-insights";
import { createRevisionHistoryDisplay } from "@/components/domain/revision-history-display";
import { BatchBlendHistory } from "@/components/domain/batch-blend-history";
import { batchSchema, batchStates, batchTransitions } from "@/lib/schemas/batch";

// Re-export schema so existing client-side imports keep working
export { batchSchema, type BatchFormValues } from "@/lib/schemas/batch";

// Base table type for form operations
type BatchTable = Database["public"]["Tables"]["batches"]["Row"];

// View type has additional computed fields but nullable id (views can return null)
type BatchViewRaw = Database["public"]["Views"]["batches_with_brew_info"]["Row"];

// Combined type for entity config: table fields + view computed fields with non-null id
// This is the type used for list/detail display where id is always present
type Batch = BatchTable & {
  // Computed fields from batches_with_brew_info view
  actual_og: number | null;
  brew_count: number | null;
  brew_date: string | null;
  current_vessel_id: string | null;
  current_vessel_name: string | null;
  volume_from_brews_bbl: number | null;
};

// =============================================================================
// State Machine (defined separately to derive options)
// =============================================================================

const batchStateMachine: StateMachineConfig<Batch> = {
  stateField: "status",
  states: [...batchStates],
  initialState: "planned",
  transitions: batchTransitions,
  stateDisplay: {
    planned: { label: "Planned", color: "default" },
    fermenting: { label: "Fermenting", color: "info" },
    conditioning: { label: "Conditioning", color: "info" },
    packaging: { label: "Packaging", color: "warning" },
    completed: { label: "Completed", color: "success" },
    cancelled: { label: "Cancelled", color: "default" },
    archived: { label: "Archived", color: "error" },
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
  viewTable: "batches_with_brew_info",  // Includes brew_date, actual_og from linked brew_logs
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
      accessorKey: "current_vessel_name",
      header: "Vessel",
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
      id: "quick-links",
      title: "Quick Actions",
      component: BatchQuickLinks,
    },
    {
      id: "overview",
      title: "Overview",
      fields: [
        { field: "batch_number", label: "Batch Number" },
        { field: "name", label: "Name" },
        { field: "status", label: "Status" },
        { field: "planned_start_date", label: "Planned Start", format: "date" },
        { field: "volume_bbl", label: "Volume", format: "unit", unitType: "volume" },
        { field: "current_vessel_name", label: "Vessel" },
      ],
    },
    {
      id: "brew-info",
      title: "Brewing",
      component: BatchBrewInfo,
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
      id: "ai-insights",
      title: "AI Insights",
      component: BatchInsights,
    },
    {
      id: "blend-history",
      title: "Blend History",
      component: BatchBlendHistory,
      collapsible: true,
    },
    {
      id: "notes",
      title: "Notes",
      fields: [
        { field: "notes", label: "Notes", fullWidth: true },
      ],
      collapsible: true,
    },
    {
      id: "cancellation",
      title: "Cancellation Details",
      component: BatchCancellationInfo,
    },
    {
      id: "revision-history",
      title: "Revision History",
      component: createRevisionHistoryDisplay("batches"),
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
      name: "blend",
      label: "Blend Batches",
      icon: "git-merge",
      type: "dropdown",
      fromStates: ["fermenting", "conditioning"],
      // Opens BatchBlendDialog - no state transition, just records blend sources
    },
    {
      name: "cancel",
      label: "Cancel Batch",
      icon: "x",
      type: "dropdown",
      variant: "destructive",
      fromStates: ["planned"],
      toState: "cancelled",
      // Simple cancel for planned batches - no loss to record
    },
    {
      name: "archive",
      label: "Archive Batch",
      icon: "archive",
      type: "dropdown",
      variant: "destructive",
      fromStates: ["fermenting", "conditioning", "packaging"],
      toState: "archived",
      // Uses BatchArchiveDialog for in-progress batches - records loss
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
      name: "vessel_transfers",
      entity: "vessel_transfer",
      type: "hasMany",
      foreignKey: "batch_id",
      showInDetail: true,
      detailTab: "Transfers",
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

  keyFields: ["batch_number", "name", "status", "planned_start_date", "current_vessel_name"],
};
