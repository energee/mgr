/**
 * Location Transfer Entity — presentation
 *
 * The React/UI half of the location transfer entity: list columns, list
 * filters, unified detail/edit sections, and actions.
 */

import type { EntityPresentation } from "@/types/entity";
import { StatusBadge } from "@/components/universal/status-badge";
import { locationTransferStateMachine, statusOptions } from "./core";
import type { LocationTransferView } from "./core";

export const locationTransferPresentation: EntityPresentation<LocationTransferView> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "from_location_name",
      header: "From",
      sortable: true,
      render: (_value, row) => {
        const data = row as LocationTransferView;
        if (data.from_location_name && data.from_bin_name) {
          return `${data.from_location_name} / ${data.from_bin_name}`;
        }
        return data.from_location_name || data.from_bin_name || "—";
      },
    },
    {
      accessorKey: "to_location_name",
      header: "To",
      sortable: true,
      render: (_value, row) => {
        const data = row as LocationTransferView;
        if (data.to_location_name && data.to_bin_name) {
          return `${data.to_location_name} / ${data.to_bin_name}`;
        }
        return data.to_location_name || data.to_bin_name || "—";
      },
    },
    {
      accessorKey: "lines_count",
      header: "Lines",
      sortable: true,
    },
    {
      accessorKey: "status",
      header: "Status",
      sortable: true,
      render: (value) => (
        <StatusBadge
          status={value as string}
          config={locationTransferStateMachine.stateDisplay}
        />
      ),
    },
    {
      accessorKey: "ship_date",
      header: "Ship Date",
      sortable: true,
      format: "date",
    },
    {
      accessorKey: "delivery_number",
      header: "Delivery",
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

  // ---------------------------------------------------------------------------
  // Unified Sections (for EntityDetailUnified)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        {
          name: "from_bin_id",
          label: "From Bin",
          type: "relation",
          relation: { entity: "bin", displayField: "name" },
          description: "Source bin to transfer from",
          required: true,
          colSpan: 6,
        },
        {
          name: "from_location_name" as keyof LocationTransferView & string,
          label: "From Location",
          editable: false,
          colSpan: 6,
        },
        {
          name: "to_bin_id",
          label: "To Bin",
          type: "relation",
          relation: { entity: "bin", displayField: "name" },
          description: "Destination bin to transfer to",
          required: true,
          colSpan: 6,
        },
        {
          name: "to_location_name" as keyof LocationTransferView & string,
          label: "To Location",
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
          name: "lines_count" as keyof LocationTransferView & string,
          label: "Line Items",
          editable: false,
          colSpan: 3,
        },
        {
          name: "delivery_id",
          label: "Delivery",
          type: "relation",
          relation: { entity: "delivery", displayField: "delivery_number" },
          description: "Optional delivery run this transfer belongs to",
          colSpan: 6,
        },
      ],
    },
    {
      id: "shipping",
      title: "Shipping Details",
      fields: [
        { name: "ship_date", label: "Ship Date", format: "datetime", editable: false, colSpan: 6 },
        { name: "shipped_by", label: "Shipped By", editable: false, colSpan: 6 },
        { name: "receive_date", label: "Receive Date", format: "datetime", editable: false, colSpan: 6 },
        { name: "received_by", label: "Received By", editable: false, colSpan: 6 },
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
          placeholder: "Transfer instructions, special handling...",
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
      // No toState — handled by ShipTransferDialog via onAction
    },
    {
      name: "receive",
      label: "Receive",
      icon: "package-check",
      type: "button",
      fromStates: ["in_transit"],
      toState: "completed",
    },
    {
      name: "cancel",
      label: "Cancel Transfer",
      icon: "x",
      type: "dropdown",
      variant: "destructive",
      fromStates: ["planned", "in_transit"],
      toState: "cancelled",
      confirm: true,
    },
  ],
};
