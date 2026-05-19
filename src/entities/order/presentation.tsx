/**
 * Order Entity — presentation
 *
 * The React/UI half of the order entity: list columns, list filters, the
 * unified detail/edit sections, actions, kanban config, and the order items
 * relation component.
 */

import type { EntityPresentation } from "@/types/entity";
import { StatusBadge } from "@/components/universal/status-badge";
import { createRevisionHistoryDisplay } from "@/components/domain/shared/revision-history-display";
import { OrderQuickLinks } from "@/components/domain/order/order-quick-links";
import { OrderItemsEditor } from "@/components/domain/order/order-items-editor";
import { ChangeRequestReview } from "@/components/domain/order/change-request-review";
import { createQBOSyncDisplay } from "@/components/domain/shared/qbo-sync-section";
import { OrderShippingMaterialsEditor } from "@/components/domain/order/order-shipping-materials-editor";
import { orderCore, statusOptions } from "./core";
import type { Order } from "./core";

// Wrapper component to adapt OrderItemsEditor to relation component interface
function OrderItemsRelation({ parentId, data }: { parentId: string; data?: Record<string, unknown> }) {
  return (
    <OrderItemsEditor
      orderId={parentId}
      customerId={data?.customer_id as string | null | undefined}
    />
  );
}

// Wrapper component to adapt OrderShippingMaterialsEditor to section component interface.
// The section component receives the full order `data` row; we extract `id` to pass as orderId.
function OrderShippingMaterialsSection({ data }: { data: Order }) {
  return <OrderShippingMaterialsEditor orderId={data.id} />;
}

export const orderPresentation: EntityPresentation<Order> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "order_number",
      header: "Order #",
      sortable: true,
    },
    {
      accessorKey: "status",
      header: "Status",
      sortable: true,
      render: (value) => (
        <StatusBadge
          status={value as string}
          config={orderCore.stateMachine?.stateDisplay}
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
      accessorKey: "requested_date",
      header: "Requested",
      sortable: true,
      format: "date",
    },
    {
      accessorKey: "scheduled_date",
      header: "Scheduled",
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
      id: "quick-links",
      title: "Quick Actions",
      component: OrderQuickLinks,
    },
    {
      id: "overview",
      title: "Overview",
      fields: [
        {
          name: "order_number",
          label: "Order Number",
          type: "text",
          placeholder: "e.g., ORD-2025-001",
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
          name: "customer_id",
          label: "Customer",
          type: "relation",
          relation: {
            entity: "customer",
            displayField: "name",
          },
          colSpan: 6,
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
          name: "requested_date",
          label: "Requested Delivery Date",
          type: "date",
          format: "date",
          colSpan: 4,
        },
        {
          name: "scheduled_date",
          label: "Scheduled Delivery Date",
          type: "date",
          format: "date",
          colSpan: 4,
        },
        {
          name: "fulfilled_date",
          label: "Fulfilled Date",
          format: "date",
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
          placeholder: "Special instructions, delivery notes...",
          fullWidth: true,
          colSpan: 12,
        },
      ],
    },
    {
      id: "shipping-materials",
      title: "Shipping Materials",
      component: OrderShippingMaterialsSection,
      collapsible: true,
    },
    {
      id: "change-requests",
      title: "Change Requests",
      component: ChangeRequestReview,
      collapsible: true,
    },
    {
      id: "qbo-sync",
      title: "QuickBooks",
      component: createQBOSyncDisplay("order"),
    },
    {
      id: "revision-history",
      title: "Revision History",
      component: createRevisionHistoryDisplay("orders"),
      collapsible: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Kanban Board
  // ---------------------------------------------------------------------------
  kanbanConfig: {
    titleField: "order_number",
    cardFields: [
      { field: "order_date", label: "Ordered", format: "date" },
      { field: "requested_date", label: "Requested", format: "date" },
    ],
  },

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "confirm",
      label: "Confirm Order",
      icon: "check",
      type: "button",
      fromStates: ["draft"],
      toState: "confirmed",
    },
    {
      name: "schedule",
      label: "Schedule Delivery",
      icon: "calendar",
      type: "button",
      fromStates: ["confirmed"],
      toState: "scheduled",
    },
    {
      name: "start_picking",
      label: "Start Picking",
      icon: "package",
      type: "button",
      fromStates: ["scheduled"],
      toState: "picking",
    },
    {
      name: "mark_packed",
      label: "Mark Packed",
      icon: "box",
      type: "button",
      fromStates: ["picking"],
      toState: "packed",
    },
    {
      name: "fulfill",
      label: "Mark Fulfilled",
      icon: "truck",
      type: "button",
      fromStates: ["packed"],
      toState: "fulfilled",
    },
    {
      name: "cancel",
      label: "Cancel Order",
      icon: "x",
      type: "dropdown",
      variant: "destructive",
      fromStates: ["draft", "confirmed", "scheduled", "picking", "packed"],
      toState: "cancelled",
      confirm: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Relation components — woven onto `core.relations` by createEntityConfig()
  // ---------------------------------------------------------------------------
  relationComponents: {
    order_items: OrderItemsRelation,
  },
};
