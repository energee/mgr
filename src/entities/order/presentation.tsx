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
import { createQBOSyncDisplay } from "@/components/domain/shared/qbo-sync-display";
import { OrderShippingMaterialsEditor } from "@/components/domain/order/order-shipping-materials-editor";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { parseUnknownError } from "@/lib/errors";
import { localDateString } from "@/lib/format";
import { duplicateOrder } from "@/components/domain/order/reorder";
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
      // Server-side sortable/searchable via the order_list_details view.
      accessorKey: "customer_name",
      header: "Customer",
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
    {
      // Computed by the order_list_details view (sum of line items).
      accessorKey: "total_amount",
      header: "Total",
      sortable: true,
      format: "currency",
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
      // Links build hrefs from the persisted order id — none before first save.
      hideOnCreate: true,
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
          // Defaults to today (local date — see localDateString).
          defaultValue: () => localDateString(),
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
      // Editor persists rows keyed by order id, absent on a brand-new order.
      hideOnCreate: true,
    },
    {
      id: "change-requests",
      title: "Change Requests",
      component: ChangeRequestReview,
      collapsible: true,
      // A brand-new order can't have change requests.
      hideOnCreate: true,
    },
    {
      id: "qbo-sync",
      title: "QuickBooks",
      component: createQBOSyncDisplay("order"),
      // Sync status only exists for persisted orders.
      hideOnCreate: true,
    },
    {
      id: "revision-history",
      title: "Revision History",
      component: createRevisionHistoryDisplay("orders"),
      collapsible: true,
      // No revisions before the first save.
      hideOnCreate: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Kanban Board
  // ---------------------------------------------------------------------------
  kanbanConfig: {
    titleField: "order_number",
    cardFields: [
      { field: "customer_name", label: "Customer" },
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
      // Collect the delivery date in a pre-transition dialog; written in the
      // same UPDATE as the status flip (defaults to the requested date).
      transitionFields: [
        {
          name: "scheduled_date",
          label: "Scheduled Delivery Date",
          type: "date",
          required: true,
          defaultValue: (order) => order.requested_date,
        },
      ],
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
      // Duplicate Order / Reorder. Orders can't use the framework Duplicate
      // path (line items live in the order_items child table, editable only
      // post-create); this handler inserts a complete draft copy (header +
      // items, prices re-resolved at current tier pricing) and navigates to
      // it. No fromStates: reordering fulfilled/cancelled orders is the point.
      name: "duplicate",
      label: "Duplicate Order",
      icon: "copy",
      type: "dropdown",
      confirm: true,
      handler: async (order) => {
        try {
          const { id, orderNumber } = await duplicateOrder(createClient(), order.id);
          toast.success(`Draft order ${orderNumber} created`);
          window.location.assign(`/sales/orders/${id}`);
        } catch (err) {
          toast.error(parseUnknownError(err).message);
        }
      },
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
