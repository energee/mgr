/**
 * Vessel Entity — presentation
 *
 * The React/UI half of the vessel entity: list columns, list filters, the
 * unified detail/edit sections, and actions. VesselCurrentBatch is used as a
 * section-level component (not a relation component).
 */

import type { EntityPresentation } from "@/types/entity";
import { deleteAction } from "@/types/entity";
import { getValueLabel } from "@/types/entity";
import { StatusBadge } from "@/components/universal/status-badge";
import { Badge } from "@/components/ui/badge";
import { VesselCurrentBatch } from "@/components/domain/batch/vessel-current-batch";
import { vesselCore, statusOptions, vesselTypeOptions } from "./core";
import type { Vessel } from "./core";
import type { Database } from "@/types/supabase";

// Extended type for list view (includes batch info from vessels_with_batch view)
type VesselWithBatch = Database["public"]["Views"]["vessels_with_batch"]["Row"];

export const vesselPresentation: EntityPresentation<Vessel> = {
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
          {getValueLabel(vesselCore, "vessel_type", value as string)}
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
          config={vesselCore.stateMachine?.stateDisplay}
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

  // Framework Duplicate action (EntityDetailUnified): status is the state
  // field (framework-excluded); name carries over for the user to renumber
  // (e.g. "FV1" → "FV5") and type/capacity/location copy as-is.
  excludeOnDuplicate: [],

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
    deleteAction("Vessel"),
  ],
};
