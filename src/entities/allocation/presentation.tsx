/**
 * Allocation Entity — presentation
 *
 * The React/UI half of the allocation entity: list columns, list filters,
 * and the unified detail/edit sections.
 */

import type { EntityPresentation } from "@/types/entity";
import { StatusBadge } from "@/components/universal/status-badge";
import type { Allocation } from "./core";
import {
  SOURCE_TYPES,
  DESTINATION_TYPES,
  REASON_CODES,
  allocationStateMachine,
  statusOptions,
} from "./core";

export const allocationPresentation: EntityPresentation<Allocation> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "status",
      header: "Status",
      render: (value) => (
        <StatusBadge
          status={value as string}
          config={allocationStateMachine.stateDisplay}
        />
      ),
    },
    {
      accessorKey: "source_type",
      header: "Source",
      render: (value) => {
        const sourceType = SOURCE_TYPES.find((s) => s.value === value);
        return sourceType?.label || String(value);
      },
    },
    {
      accessorKey: "destination_type",
      header: "Destination",
      render: (value) => {
        const destType = DESTINATION_TYPES.find((d) => d.value === value);
        return destType?.label || String(value);
      },
    },
    {
      accessorKey: "quantity",
      header: "Quantity",
      format: "number",
    },
    {
      accessorKey: "created_at",
      header: "Created",
      format: "datetime",
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
      type: "multiselect",
      label: "Source Type",
      options: SOURCE_TYPES,
    },
    {
      field: "destination_type",
      type: "multiselect",
      label: "Destination Type",
      options: DESTINATION_TYPES,
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
          name: "source_type",
          label: "Source Type",
          type: "select",
          options: SOURCE_TYPES,
          required: true,
          description: "Where the inventory comes from",
          colSpan: 6,
        },
        {
          name: "source_id",
          label: "Source ID",
          type: "text",
          placeholder: "UUID of source record (optional for external)",
          colSpan: 6,
        },
        {
          name: "destination_type",
          label: "Destination Type",
          type: "select",
          options: DESTINATION_TYPES,
          required: true,
          description: "Where the inventory goes",
          colSpan: 6,
        },
        {
          name: "destination_id",
          label: "Destination ID",
          type: "text",
          placeholder: "UUID of destination record (optional)",
          colSpan: 6,
        },
        {
          name: "status",
          label: "Status",
          type: "select",
          options: statusOptions,
          editable: false,
          colSpan: 6,
        },
      ],
    },
    {
      id: "quantities",
      title: "Quantities",
      fields: [
        {
          name: "quantity",
          label: "Quantity",
          type: "number",
          format: "number",
          required: true,
          placeholder: "e.g., 10",
          description: "Always positive",
          colSpan: 4,
        },
        {
          name: "volume_bbl",
          label: "Volume (BBL)",
          type: "unit",
          unitType: "volume",
          format: "unit",
          placeholder: "e.g., 5.5",
          description: "For TTB reporting",
          colSpan: 4,
        },
        {
          name: "unit_cost",
          label: "Unit Cost",
          type: "number",
          format: "currency",
          placeholder: "e.g., 2.50",
          colSpan: 4,
        },
        {
          name: "lot_number",
          label: "Lot Number",
          type: "text",
          placeholder: "e.g., LOT-2024-001",
          colSpan: 6,
        },
      ],
    },
    {
      id: "reason",
      title: "Reason",
      collapsible: true,
      fields: [
        {
          name: "reason_code",
          label: "Reason Code",
          type: "select",
          options: REASON_CODES,
          description: "For samples, adjustments, losses, etc.",
          colSpan: 6,
        },
        {
          name: "requires_approval",
          label: "Requires Approval",
          type: "switch",
          colSpan: 6,
        },
        {
          name: "notes",
          label: "Notes",
          type: "textarea",
          placeholder: "Additional details...",
          fullWidth: true,
          colSpan: 12,
        },
      ],
    },
    {
      id: "approval",
      title: "Approval",
      collapsible: true,
      fields: [
        {
          name: "approved_by",
          label: "Approved By",
          editable: false,
          colSpan: 6,
        },
        {
          name: "approved_at",
          label: "Approved At",
          format: "datetime",
          editable: false,
          colSpan: 6,
        },
        {
          name: "rejection_reason",
          label: "Rejection Reason",
          editable: false,
          fullWidth: true,
          colSpan: 12,
        },
      ],
    },
    {
      id: "timestamps",
      title: "Timestamps",
      collapsible: true,
      fields: [
        {
          name: "created_at",
          label: "Created",
          format: "datetime",
          editable: false,
          colSpan: 6,
        },
        {
          name: "created_by",
          label: "Created By",
          editable: false,
          colSpan: 6,
        },
        {
          name: "completed_at",
          label: "Completed",
          format: "datetime",
          editable: false,
          colSpan: 6,
        },
        {
          name: "cancelled_at",
          label: "Cancelled",
          format: "datetime",
          editable: false,
          colSpan: 6,
        },
        {
          name: "updated_at",
          label: "Updated",
          format: "datetime",
          editable: false,
          colSpan: 6,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "complete",
      label: "Complete",
      icon: "check",
      type: "button",
      fromStates: ["planned"],
      toState: "completed",
    },
    {
      name: "submit_for_approval",
      label: "Submit for Approval",
      icon: "send",
      type: "button",
      fromStates: ["planned"],
      toState: "pending_approval",
    },
    {
      name: "approve",
      label: "Approve",
      icon: "check-circle",
      type: "button",
      fromStates: ["pending_approval"],
      toState: "completed",
    },
    {
      name: "reject",
      label: "Reject",
      icon: "x-circle",
      type: "dropdown",
      variant: "destructive",
      fromStates: ["pending_approval"],
      toState: "rejected",
      confirm: true,
    },
    {
      name: "cancel",
      label: "Cancel",
      icon: "x",
      type: "dropdown",
      variant: "destructive",
      fromStates: ["planned"],
      toState: "cancelled",
      confirm: true,
    },
  ],
};
