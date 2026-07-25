/**
 * Pick List Entity — presentation
 *
 * The React/UI half of the pick list entity: list columns, list filters, and
 * the unified detail/edit sections.
 */

import type { EntityPresentation } from "@/types/entity";
import { StatusBadge } from "@/components/universal/status-badge";
import { PickListItems } from "@/components/domain/order/pick-list-items";
import { pickListCore, statusOptions } from "./core";
import type { PickListView } from "./core";

export const pickListPresentation: EntityPresentation<PickListView> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "order_number",
      header: "Order #",
    },
    {
      accessorKey: "customer_name",
      header: "Customer",
    },
    {
      accessorKey: "status",
      header: "Status",
      render: (value) => (
        <StatusBadge
          status={value as string}
          config={pickListCore.stateMachine?.stateDisplay}
        />
      ),
    },
    {
      accessorKey: "total_items",
      header: "Items",
      render: (value, row) => {
        const data = row as PickListView;
        return `${data.items_picked}/${data.total_items}`;
      },
    },
    {
      accessorKey: "assigned_to_name",
      header: "Assigned To",
    },
    {
      accessorKey: "generated_at",
      header: "Generated",
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
          name: "order_id",
          label: "Order",
          type: "relation",
          relation: { entity: "order", displayField: "order_number" },
          required: true,
          colSpan: 6,
        },
        {
          name: "order_number" as keyof PickListView & string,
          label: "Order Number",
          editable: false,
          colSpan: 6,
        },
        {
          name: "customer_name" as keyof PickListView & string,
          label: "Customer",
          editable: false,
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
          name: "assigned_to",
          label: "Assigned To",
          type: "relation",
          relation: { entity: "user_profile", displayField: "display_name" },
          colSpan: 6,
        },
        {
          name: "generated_at",
          label: "Generated",
          format: "datetime",
          editable: false,
          colSpan: 6,
        },
        {
          name: "started_at",
          label: "Started",
          format: "datetime",
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
      ],
    },
    {
      id: "pick-items",
      title: "Pick Items",
      component: PickListItems,
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
          placeholder: "Picking instructions, special handling...",
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
      name: "assign",
      label: "Assign",
      icon: "user",
      type: "button",
      fromStates: ["draft"],
      toState: "assigned",
      // Collect the assignee in a pre-transition dialog; written to the
      // pick_lists base table in the same UPDATE as the status flip.
      transitionFields: [
        {
          name: "assigned_to",
          label: "Assigned To",
          type: "relation",
          relation: { entity: "user_profile", displayField: "display_name" },
          required: true,
        },
      ],
    },
    {
      name: "start_picking",
      label: "Start Picking",
      icon: "play",
      type: "button",
      fromStates: ["assigned"],
      toState: "in_progress",
    },
    {
      name: "complete",
      label: "Complete",
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
      fromStates: ["draft", "assigned", "in_progress"],
      toState: "cancelled",
      confirm: true,
    },
  ],
};
