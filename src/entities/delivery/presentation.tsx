/**
 * Delivery Entity — presentation
 *
 * The React/UI half of the delivery entity: list columns, list filters, and
 * the unified detail/edit sections.
 */

import type { EntityPresentation } from "@/types/entity";
import { StatusBadge } from "@/components/universal/status-badge";
import { deliveryCore, statusOptions } from "./core";
import type { DeliveryView } from "./core";

export const deliveryPresentation: EntityPresentation<DeliveryView> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "delivery_number",
      header: "Delivery #",
      sortable: true,
    },
    {
      accessorKey: "scheduled_date",
      header: "Scheduled",
      sortable: true,
      format: "date",
    },
    {
      accessorKey: "driver_name",
      header: "Driver",
      sortable: true,
    },
    {
      accessorKey: "total_stops",
      header: "Stops",
      sortable: true,
    },
    {
      accessorKey: "status",
      header: "Status",
      sortable: true,
      render: (value) => (
        <StatusBadge
          status={value as string}
          config={deliveryCore.stateMachine?.stateDisplay}
        />
      ),
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
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Delivery Details",
      fields: [
        {
          name: "delivery_number",
          label: "Delivery #",
          editable: false,
          colSpan: 6,
        },
        {
          name: "status",
          label: "Status",
          editable: false,
          colSpan: 6,
        },
        {
          name: "scheduled_date",
          label: "Scheduled Date",
          type: "date",
          format: "date",
          colSpan: 6,
        },
        {
          name: "driver_name",
          label: "Driver",
          type: "text",
          colSpan: 6,
        },
        {
          name: "vehicle",
          label: "Vehicle",
          type: "text",
          colSpan: 6,
        },
      ],
    },
    {
      id: "shipping",
      title: "Shipping",
      fields: [
        {
          name: "ship_date",
          label: "Shipped",
          format: "datetime",
          editable: false,
          colSpan: 6,
        },
        {
          name: "receive_date",
          label: "Received",
          format: "datetime",
          editable: false,
          colSpan: 6,
        },
      ],
    },
    {
      id: "summary",
      title: "Stops Summary",
      fields: [
        {
          name: "transfer_count",
          label: "Transfers",
          editable: false,
          colSpan: 4,
        },
        {
          name: "order_count",
          label: "Orders",
          editable: false,
          colSpan: 4,
        },
        {
          name: "total_stops",
          label: "Total Stops",
          editable: false,
          colSpan: 4,
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
          fullWidth: true,
          colSpan: 12,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "ship",
      label: "Ship",
      icon: "truck",
      type: "button",
      fromStates: ["planned"],
      toState: "in_transit",
    },
    {
      name: "complete",
      label: "Complete",
      icon: "check",
      type: "button",
      fromStates: ["in_transit"],
      toState: "completed",
    },
    {
      name: "cancel",
      label: "Cancel",
      icon: "x",
      type: "dropdown",
      variant: "destructive",
      fromStates: ["planned", "in_transit"],
      toState: "cancelled",
      confirm: true,
    },
  ],
};
