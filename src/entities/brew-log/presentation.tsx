/**
 * Brew Log Entity — presentation
 *
 * The React/UI half of the brew log entity: list columns, list filters, the
 * unified detail/edit sections (including section-level timeline and batch
 * components), and state-transition actions.
 */

import type { EntityPresentation } from "@/types/entity";
import { StatusBadge } from "@/components/universal/status-badge";
import { BrewLogTimeline } from "@/components/domain/brew/brew-log-timeline";
import { BrewEventTimelineActions } from "@/components/domain/brew/brew-event-timeline";
import { BrewLogSplitOverview } from "@/components/domain/brew/brew-log-split-overview";
import { createRevisionHistoryDisplay } from "@/components/domain/shared/revision-history-display";
import type { BrewLog } from "./core";
import { brewLogStateMachine, statusOptions } from "./core";

export const brewLogPresentation: EntityPresentation<BrewLog> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "brew_number",
      header: "Brew #",
    },
    {
      accessorKey: "recipe_name",
      header: "Recipe",
    },
    {
      accessorKey: "brew_date",
      header: "Brew Date",
      format: "date",
    },
    {
      accessorKey: "status",
      header: "Status",
      render: (value) => (
        <StatusBadge
          status={value as string}
          config={brewLogStateMachine.stateDisplay}
        />
      ),
    },
    {
      accessorKey: "batch_codes",
      header: "Batches",
      render: (value) => (value as string) || "—",
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
          placeholder: "Add observations about this brew day...",
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
};
