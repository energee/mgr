/**
 * Purchase Order Entity — presentation
 *
 * The React/UI half of the purchase order entity: list columns, list filters,
 * unified detail/edit sections, and actions.
 */

import type { EntityPresentation } from "@/types/entity";
import { StatusBadge } from "@/components/universal/status-badge";
import { createRevisionHistoryDisplay } from "@/components/domain/shared/revision-history-display";
import { createQBOSyncDisplay } from "@/components/domain/shared/qbo-sync-section";
import { purchaseOrderStateMachine, statusOptions } from "./core";
import type { PurchaseOrder } from "./core";

export const purchaseOrderPresentation: EntityPresentation<PurchaseOrder> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "po_number",
      header: "PO #",
      sortable: true,
    },
    {
      accessorKey: "status",
      header: "Status",
      sortable: true,
      render: (value) => (
        <StatusBadge
          status={value as string}
          config={purchaseOrderStateMachine.stateDisplay}
        />
      ),
    },
    {
      accessorKey: "order_date",
      header: "Order Date",
      sortable: true,
      format: "date",
    },
    {
      accessorKey: "expected_date",
      header: "Expected",
      sortable: true,
      format: "date",
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
      title: "Overview",
      fields: [
        {
          name: "po_number",
          label: "PO Number",
          type: "text",
          placeholder: "e.g., PO-2025-001",
          required: true,
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
        {
          name: "supplier_id",
          label: "Supplier",
          type: "relation",
          relation: { entity: "supplier", displayField: "name" },
          colSpan: 12,
        },
        {
          name: "order_date",
          label: "Order Date",
          type: "date",
          format: "date",
          required: true,
          colSpan: 6,
        },
        {
          name: "expected_date",
          label: "Expected Delivery Date",
          type: "date",
          format: "date",
          colSpan: 6,
        },
        {
          name: "submitted_at",
          label: "Submitted At",
          format: "datetime",
          editable: false,
          colSpan: 6,
        },
      ],
    },
    {
      id: "costs",
      title: "Costs",
      fields: [
        {
          name: "shipping_cost",
          label: "Shipping Cost",
          type: "number",
          format: "currency",
          placeholder: "0.00",
          colSpan: 6,
        },
        {
          name: "tax",
          label: "Tax",
          type: "number",
          format: "currency",
          placeholder: "0.00",
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
          placeholder: "Special instructions, delivery notes...",
          fullWidth: true,
          colSpan: 12,
        },
      ],
    },
    {
      id: "qbo-sync",
      title: "QuickBooks",
      component: createQBOSyncDisplay("purchase_order"),
    },
    {
      id: "revision-history",
      title: "Revision History",
      component: createRevisionHistoryDisplay("purchase_orders"),
      collapsible: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "submit",
      label: "Submit to Supplier",
      icon: "send",
      type: "button",
      fromStates: ["draft"],
      toState: "submitted",
    },
    {
      name: "confirm",
      label: "Mark Confirmed",
      icon: "check",
      type: "button",
      fromStates: ["submitted"],
      toState: "confirmed",
    },
    {
      name: "mark_partial",
      label: "Partial Receipt",
      icon: "package",
      type: "button",
      fromStates: ["confirmed"],
      toState: "partial",
    },
    {
      name: "fulfill",
      label: "Mark Fulfilled",
      icon: "check-circle",
      type: "button",
      fromStates: ["confirmed", "partial"],
      toState: "fulfilled",
    },
    {
      name: "close",
      label: "Close PO",
      icon: "archive",
      type: "button",
      fromStates: ["fulfilled"],
      toState: "closed",
    },
    {
      name: "cancel",
      label: "Cancel PO",
      icon: "x",
      type: "dropdown",
      variant: "destructive",
      fromStates: ["draft", "submitted", "confirmed", "partial"],
      toState: "cancelled",
      confirm: true,
    },
    {
      name: "accept_into_inventory",
      label: "Accept into Inventory",
      icon: "package-check",
      type: "button",
      variant: "default",
      fromStates: ["partial", "fulfilled"],
    },
    {
      name: "calculate_landed_cost",
      label: "Calculate Landed Cost",
      icon: "calculator",
      type: "button",
      variant: "outline",
      fromStates: ["partial", "fulfilled", "closed"],
      confirm: true,
    },
  ],
};
