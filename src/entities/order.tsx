/**
 * Order Entity Configuration
 *
 * Orders track sales from draft through fulfillment.
 * Lifecycle: draft → confirmed → scheduled → picking → packed → fulfilled
 */

import { z } from "zod";
import { toast } from "sonner";
import type { EntityConfig, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { createClient } from "@/lib/supabase/client";
import { parseUnknownError } from "@/lib/errors";
import { duplicateOrder } from "@/components/domain/order/reorder";
import { StatusBadge } from "@/components/universal/status-badge";
import { createRevisionHistoryDisplay } from "@/components/domain/shared/revision-history-display";
import { OrderQuickLinks } from "@/components/domain/order/order-quick-links";
import { OrderItemsEditor } from "@/components/domain/order/order-items-editor";
import { ChangeRequestReview } from "@/components/domain/order/change-request-review";
import { createQBOSyncDisplay } from "@/components/domain/shared/qbo-sync-section";
import { OrderShippingMaterialsEditor } from "@/components/domain/order/order-shipping-materials-editor";

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

// Base type from orders table
type OrderBase = Database["public"]["Tables"]["orders"]["Row"];

// Extended type for list/detail reads: the entity reads from the
// order_list_details view (migration 00185), which is orders.* plus the
// joined customer name. Writes still target the orders base table.
type Order = OrderBase & {
  customer_name?: string | null;
};

// =============================================================================
// Zod Schema
// =============================================================================

export const orderSchema = z.object({
  order_number: z.string().min(1, "Order number is required"),
  customer_id: z.string().uuid().nullable().optional(),
  status: z.string().default("draft"),
  order_date: z.string().min(1, "Order date is required"),
  requested_date: z.string().nullable().optional(),
  scheduled_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type OrderFormValues = z.infer<typeof orderSchema>;

// =============================================================================
// State Machine (defined separately to derive options)
// =============================================================================

const orderStateMachine: StateMachineConfig<Order> = {
  stateField: "status",
  states: ["draft", "confirmed", "scheduled", "picking", "packed", "fulfilled", "cancelled"],
  initialState: "draft",
  transitions: {
    draft: ["confirmed", "cancelled"],
    confirmed: ["scheduled", "cancelled"],
    scheduled: ["picking", "cancelled"],
    picking: ["packed", "cancelled"],
    packed: ["fulfilled", "cancelled"],
    fulfilled: [],
    cancelled: [],
  },
  stateDisplay: {
    draft: { label: "Draft", color: "default" },
    confirmed: { label: "Confirmed", color: "info" },
    scheduled: { label: "Scheduled", color: "info" },
    picking: { label: "Picking", color: "warning" },
    packed: { label: "Packed", color: "warning" },
    fulfilled: { label: "Fulfilled", color: "success" },
    cancelled: { label: "Cancelled", color: "error" },
  },
  // Scheduling must go through the schedule action so its transitionFields
  // dialog captures scheduled_date — bulk/raw status flips into "scheduled"
  // are suppressed (a scheduled order without a date is meaningless to
  // production planning, which keys off COALESCE(scheduled_date, requested_date)).
  requiresAction: {
    scheduled: "schedule",
  },
};

// Derive status options from state machine (single source of truth)
const statusOptions = statesAsOptions(orderStateMachine);

// =============================================================================
// Entity Configuration
// =============================================================================

export const orderEntity: EntityConfig<Order> = {
  name: "order",
  table: "orders",
  // Reads come from this view (adds customer_name for list/kanban/search);
  // all writes go to the orders base table.
  viewTable: "order_list_details",
  displayName: "Order",
  displayNamePlural: "Orders",
  description: "Sales orders from draft through fulfillment",
  domain: "sales",

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
      // Server-side sortable/searchable via the order_list_details view
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
          config={orderEntity.stateMachine?.stateDisplay}
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

  quickFilters: [
    {
      label: "Open",
      filters: [
        { column: "status", values: ["draft", "confirmed", "scheduled", "picking", "packed"] },
      ],
      isDefault: true,
    },
    {
      label: "Due",
      filters: [
        { column: "status", values: ["draft", "confirmed", "scheduled", "picking", "packed"] },
      ],
      sort: { column: "scheduled_date", direction: "asc" },
    },
    {
      label: "Done",
      filters: [
        { column: "status", values: ["fulfilled", "cancelled"] },
      ],
    },
  ],

  defaultSort: { column: "order_date", direction: "desc" },
  searchableFields: ["order_number", "customer_name"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "order_number",
    badge: "status",
  },

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      // hideOnCreate: links (e.g. Manage Allocations) build hrefs from
      // data.id, which is undefined before the order exists.
      id: "quick-links",
      title: "Quick Actions",
      component: OrderQuickLinks,
      hideOnCreate: true,
    },
    {
      id: "overview",
      title: "Overview",
      fields: [
        {
          // Prefilled by sales/orders/new/page.tsx with the next ORD-YYYY-NNN
          // suggestion from generate_next_order_number() (migration 00186).
          // Stays editable; the orders_order_number_key UNIQUE constraint
          // backstops concurrent suggestions.
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
          // Defaults to today on create (the answer ~95% of the time);
          // editable for backdating. Sync function per buildDefaultValues.
          name: "order_date",
          label: "Order Date",
          type: "date",
          format: "date",
          required: true,
          defaultValue: () => new Date().toISOString().split("T")[0],
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
          // Set by the orders BEFORE UPDATE trigger when status transitions
          // to fulfilled (migration 00180) — the QBO invoice sync uses it as
          // the invoice TxnDate, so it is never written client-side.
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
      // hideOnCreate: editor queries/persists rows keyed by order id, which
      // doesn't exist yet (order creation is save-header-first, two-phase).
      id: "shipping-materials",
      title: "Shipping Materials",
      component: OrderShippingMaterialsSection,
      collapsible: true,
      hideOnCreate: true,
    },
    {
      // hideOnCreate: a brand-new order can't have change requests.
      id: "change-requests",
      title: "Change Requests",
      component: ChangeRequestReview,
      collapsible: true,
      hideOnCreate: true,
    },
    {
      // hideOnCreate: sync status only exists for persisted orders.
      id: "qbo-sync",
      title: "QuickBooks",
      component: createQBOSyncDisplay("order"),
      hideOnCreate: true,
    },
    {
      // hideOnCreate: no revisions before the first save.
      id: "revision-history",
      title: "Revision History",
      component: createRevisionHistoryDisplay("orders"),
      collapsible: true,
      hideOnCreate: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: orderSchema,

  // ---------------------------------------------------------------------------
  // State Machine
  // ---------------------------------------------------------------------------
  stateMachine: orderStateMachine,

  // ---------------------------------------------------------------------------
  // Kanban Board
  // ---------------------------------------------------------------------------
  kanbanConfig: {
    titleField: "order_number",
    cardFields: [
      // customer_name comes from the order_list_details view — kanban cards
      // read raw record fields (no relation resolution), so the view field
      // is required here rather than a customer_id relation column.
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
      // same UPDATE as the status flip (defaults to the requested date)
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
      // fulfilled_date is stamped by the orders BEFORE UPDATE trigger
      // (migration 00180), atomic with this status flip — no client write.
      name: "fulfill",
      label: "Mark Fulfilled",
      icon: "truck",
      type: "button",
      fromStates: ["packed"],
      toState: "fulfilled",
    },
    {
      // Duplicate Order / Reorder. Orders can't use the framework Duplicate
      // action (EntityConfig.excludeOnDuplicate → prefilled /new form):
      // line items live in the order_items child table, which is only
      // editable post-create. This handler instead inserts a complete draft
      // copy (header + items, unit prices re-resolved at current tier
      // pricing via get_price_for_customer) and navigates to it. No
      // fromStates: reordering fulfilled/cancelled orders is the point.
      // See src/components/domain/order/reorder.ts.
      name: "duplicate",
      label: "Duplicate Order",
      icon: "copy",
      type: "dropdown",
      confirm: true,
      handler: async (order) => {
        try {
          const { id, orderNumber } = await duplicateOrder(createClient(), order.id);
          toast.success(`Draft order ${orderNumber} created`);
          // Entity configs run outside React (no client router); a full-page
          // navigation also guarantees fresh queries for the new draft.
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
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "customer",
      entity: "customer",
      type: "belongsTo",
      foreignKey: "customer_id",
      showInDetail: true,
    },
    {
      name: "order_items",
      entity: "order_item",
      type: "hasMany",
      foreignKey: "order_id",
      showInDetail: true,
      detailTab: "Items",
      component: OrderItemsRelation,
    },
    {
      name: "pick_lists",
      entity: "pick_list",
      type: "hasMany",
      foreignKey: "order_id",
      showInDetail: true,
      detailTab: "Pick Lists",
      // No /sales/pick-lists/new route — pick lists are generated from the
      // order detail page's Pick List action.
      hideAdd: true,
    },
    {
      name: "delivery",
      entity: "delivery",
      type: "belongsTo",
      foreignKey: "delivery_id",
      showInDetail: true,
    },
  ],
};

/**
 * Change Request Status Display
 *
 * Status display config for order_change_requests (not a standalone entity,
 * but needs consistent status rendering via StatusBadge).
 */
export const changeRequestStatusDisplay: Record<
  string,
  { label: string; color: "default" | "success" | "warning" | "error" | "info" }
> = {
  pending: { label: "Pending Review", color: "warning" },
  approved: { label: "Approved", color: "success" },
  rejected: { label: "Rejected", color: "error" },
  cancelled: { label: "Cancelled", color: "default" },
};
