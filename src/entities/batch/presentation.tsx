/**
 * Batch Entity — presentation
 *
 * The React/UI half of the batch entity: list columns, list filters, quick
 * filters, the unified detail/edit sections, kanban config, and actions.
 */

import type { EntityPresentation } from "@/types/entity";
import { getValueLabel } from "@/types/entity";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { vesselCore } from "@/entities/vessel/core";
import { StatusBadge } from "@/components/universal/status-badge";
import { BatchQuickLinks } from "@/components/domain/batch/batch-quick-links";
import { BatchBrewInfo } from "@/components/domain/batch/batch-brew-info";
import { BatchCancellationInfo } from "@/components/domain/batch/batch-cancellation-info";
import { BatchInsights } from "@/components/domain/batch/batch-insights";
import { createRevisionHistoryDisplay } from "@/components/domain/shared/revision-history-display";
import { BatchBlendHistory } from "@/components/domain/batch/batch-blend-history";
import { BatchYeastSection } from "@/components/domain/batch/batch-yeast-section";
import { BatchTransferTimeline } from "@/components/domain/batch/batch-transfer-timeline";
import { batchStateMachine, statusOptions } from "./core";
import type { Batch } from "./core";

export const batchPresentation: EntityPresentation<Batch> = {
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
          config={batchStateMachine.stateDisplay}
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
                {getValueLabel(vesselCore, "vessel_type", batch.current_vessel_type)}
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
};
