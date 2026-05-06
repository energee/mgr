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
import { statesAsOptions, getValueLabel } from "@/types/entity";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { vesselEntity } from "./vessel";
import type { Database } from "@/types/supabase";
import { StatusBadge } from "@/components/universal/status-badge";
import { BatchQuickLinks } from "@/components/domain/batch-quick-links";
import { BatchBrewInfo } from "@/components/domain/batch-brew-info";
import { BatchCancellationInfo } from "@/components/domain/batch-cancellation-info";
import { BatchInsights } from "@/components/domain/batch-insights";
import { createRevisionHistoryDisplay } from "@/components/domain/revision-history-display";
import { BatchBlendHistory } from "@/components/domain/batch-blend-history";
import { BatchYeastSection } from "@/components/domain/batch-yeast-section";
import { BatchTransferTimeline } from "@/components/domain/batch-transfer-timeline";
import { batchSchema, batchStates, batchTransitions } from "@/lib/schemas/batch";

// Re-export schema so existing client-side imports keep working
export { batchSchema, type BatchFormValues } from "@/lib/schemas/batch";

// Base table type for form operations
type BatchTable = Database["public"]["Tables"]["batches"]["Row"];

// Combined type for entity config: table fields + view computed fields with non-null id
// This is the type used for list/detail display where id is always present
type Batch = BatchTable & {
  // Computed fields from batches_with_brew_info view
  actual_og: number | null;
  brew_count: number | null;
  brew_date: string | null;
  current_vessel_id: string | null;
  current_vessel_name: string | null;
  current_vessel_type: string | null;
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
  viewTable: "batches_with_brew_info",  // Includes brew stats (brew_date, actual_og, brew_count) + current vessel info (id, name, type)
  displayName: "Batch",
  displayNamePlural: "Batches",
  description: "Production batches from brewing through packaging",
  domain: "production",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "batch_code",
      header: "Batch Code",
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
      render: (value, row) => {
        if (!value) return null;
        const batch = row as Batch;
        return (
          <span className="flex items-center gap-1.5">
            {value as string}
            {batch.current_vessel_type && (
              <Badge variant="outline" className="text-[10px] px-1 py-0">
                {getValueLabel(vesselEntity, "vessel_type", batch.current_vessel_type)}
              </Badge>
            )}
          </span>
        );
      },
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
      field: "current_vessel_name",
      type: "select",
      label: "Vessel",
      fetchOptions: async () => {
        const supabase = createClient();
        const { data } = await supabase
          .from("vessels")
          .select("name")
          .not("current_batch_id", "is", null)
          .eq("is_active", true)
          .order("name");
        return (data ?? []).map((v) => ({ value: v.name, label: v.name }));
      },
    },
    {
      field: "planned_start_date",
      type: "daterange",
      label: "Planned start date",
    },
  ],

  quickFilters: [
    {
      label: "Active",
      filters: [
        { column: "status", values: ["fermenting", "conditioning", "packaging"] },
      ],
      isDefault: true,
    },
    {
      label: "Planned",
      filters: [
        { column: "status", values: ["planned"] },
      ],
      sort: { column: "planned_start_date", direction: "asc" },
    },
    {
      label: "Completed",
      filters: [
        { column: "status", values: ["completed", "cancelled", "archived"] },
      ],
    },
  ],

  defaultSort: { column: "planned_start_date", direction: "desc" },
  searchableFields: ["batch_code", "name"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "batch_code",
    subtitle: "name",
    badge: "status",
  },

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "quick-links",
      title: "Quick Actions",
      component: BatchQuickLinks,
    },
    {
      id: "overview",
      title: "Overview",
      fields: [
        {
          name: "batch_code",
          label: "Batch Code",
          type: "text",
          editable: false,
          description: "Auto-generated from planned start date and recipe",
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
          name: "status",
          label: "Status",
          type: "select",
          options: statusOptions,
          colSpan: 6,
        },
        {
          name: "planned_start_date",
          label: "Planned Start",
          type: "date",
          format: "date",
          description: "When fermentation is planned to start",
          colSpan: 6,
        },
        {
          name: "volume_bbl",
          label: "Volume",
          type: "unit",
          unitType: "volume",
          format: "unit",
          placeholder: "e.g., 10",
          colSpan: 6,
        },
        {
          name: "current_vessel_name",
          label: "Vessel",
          editable: false,
          colSpan: 6,
        },
      ],
    },
    {
      id: "brew-info",
      title: "Brewing",
      component: BatchBrewInfo,
    },
    {
      id: "yeast",
      title: "Yeast",
      component: BatchYeastSection,
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
      id: "transfer-timeline",
      title: "Transfer History",
      component: BatchTransferTimeline,
      collapsible: true,
      hideOnCreate: true,
    },
    {
      id: "cancellation",
      title: "Cancellation Details",
      component: BatchCancellationInfo,
      hideOnCreate: true,
    },
    {
      id: "revision-history",
      title: "Revision History",
      component: createRevisionHistoryDisplay("batches"),
      collapsible: true,
      hideOnCreate: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: batchSchema,

  // ---------------------------------------------------------------------------
  // State Machine
  // ---------------------------------------------------------------------------
  stateMachine: batchStateMachine,

  // ---------------------------------------------------------------------------
  // Kanban Board
  // ---------------------------------------------------------------------------
  kanbanConfig: {
    titleField: "batch_code",
    subtitleField: "name",
    cardFields: [
      { field: "planned_start_date", label: "Start", format: "date" },
      { field: "current_vessel_name", label: "Vessel" },
    ],
    excludeStates: ["archived"],
  },

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "start_brew_day",
      label: "Start Brew Day",
      icon: "play",
      type: "button",
      fromStates: ["planned"],
    },
    {
      name: "transfer",
      label: "Transfer",
      icon: "arrow-right",
      type: "button" as const,
      fromStates: ["planned", "fermenting", "conditioning"],
      // No toState — suggested by dialog based on vessel type
    },
    {
      name: "pitch_yeast",
      label: "Pitch Yeast",
      icon: "flask",
      type: "button" as const,
      fromStates: ["planned", "fermenting"],
      // No toState — suggested after pitch
    },
    {
      name: "harvest_yeast",
      label: "Harvest Yeast",
      icon: "download",
      type: "button" as const,
      fromStates: ["fermenting", "conditioning"],
      // No toState
    },
    {
      name: "start_packaging",
      label: "Start Packaging",
      icon: "package",
      type: "button" as const,
      fromStates: ["conditioning"],
      // No toState — the PackagingBatchDialog handles the transition
    },
    {
      name: "complete",
      label: "Complete",
      icon: "check",
      type: "button" as const,
      fromStates: ["packaging"],
      toState: "completed",
    },
    {
      name: "blend",
      label: "Blend Batches",
      icon: "git-merge",
      type: "dropdown" as const,
      fromStates: ["fermenting", "conditioning"],
    },
    {
      name: "cancel",
      label: "Cancel Batch",
      icon: "x",
      type: "dropdown" as const,
      variant: "destructive" as const,
      fromStates: ["planned"],
      toState: "cancelled",
    },
    {
      name: "archive",
      label: "Archive Batch",
      icon: "archive",
      type: "dropdown" as const,
      variant: "destructive" as const,
      fromStates: ["fermenting", "conditioning", "packaging"],
      toState: "archived",
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
      name: "recipe_variant",
      entity: "recipe_variant",
      type: "belongsTo",
      foreignKey: "recipe_variant_id",
      showInDetail: false,
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
      hideAdd: true,
    },
    {
      name: "yeast_events",
      entity: "yeast_pitch_event",
      type: "hasMany",
      foreignKey: "batch_id",
      showInDetail: false, // shown via custom BatchYeastSection
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

  keyFields: ["batch_code", "name", "status", "planned_start_date", "current_vessel_name"],
};
