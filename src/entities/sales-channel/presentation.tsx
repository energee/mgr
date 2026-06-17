/**
 * Sales Channel Entity — presentation
 *
 * The React/UI half of the sales channel entity: list columns, list filters,
 * and the unified detail/edit sections.
 */

import type { EntityPresentation } from "@/types/entity";
import { deleteAction, statesAsOptions } from "@/types/entity";
import { orderEntity } from "@/entities/order";
import type { SalesChannel } from "./core";

// The change-request cutoff is one of the order states (customers can request
// changes up to that state); a cancelled order can never be changed.
const cutoffStateOptions = statesAsOptions(orderEntity.stateMachine!).filter(
  (opt) => opt.value !== "cancelled"
);

export const salesChannelPresentation: EntityPresentation<SalesChannel> = {
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
      accessorKey: "code",
      header: "Code",
      sortable: true,
    },
    {
      accessorKey: "description",
      header: "Description",
    },
    {
      accessorKey: "is_active",
      header: "Active",
      sortable: true,
      render: (value) => (value ? "Yes" : "No"),
    },
  ],

  listFilters: [
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
          placeholder: "e.g., Distributor",
          required: true,
          colSpan: 6,
        },
        {
          name: "code",
          label: "Code",
          type: "text",
          placeholder: "e.g., dist",
          description: "Short code for this channel",
          required: true,
          colSpan: 6,
        },
        {
          name: "description",
          label: "Description",
          type: "textarea",
          placeholder: "Describe this sales channel...",
          colSpan: 12,
        },
        {
          name: "position",
          label: "Display Order",
          type: "number",
          placeholder: "e.g., 1",
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
      id: "customer-portal",
      title: "Customer Portal",
      fields: [
        {
          name: "change_request_cutoff_state",
          label: "Change request cutoff",
          type: "select",
          description: "Customers can request order changes until this state",
          options: cutoffStateOptions,
          colSpan: 6,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [deleteAction("Sales Channel")],
};
