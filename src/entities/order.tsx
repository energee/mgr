/**
 * Order Entity Configuration
 *
 * Orders track sales from draft through fulfillment.
 * Lifecycle: draft → confirmed → scheduled → picking → packed → fulfilled
 */

import { z } from "zod";
import type { EntityConfig, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { StatusBadge } from "@/components/universal/status-badge";
import { createRevisionHistoryDisplay } from "@/components/domain/revision-history-display";
import { OrderQuickLinks } from "@/components/domain/order-quick-links";
import { OrderItemsEditor } from "@/components/domain/order-items-editor";

// Wrapper component to adapt OrderItemsEditor to relation component interface
function OrderItemsRelation({ parentId, data }: { parentId: string; data?: Record<string, unknown> }) {
  return (
    <OrderItemsEditor
      orderId={parentId}
      customerId={data?.customer_id as string | null | undefined}
    />
  );
}

type Order = Database["public"]["Tables"]["orders"]["Row"];

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
};

// Derive status options from state machine (single source of truth)
const statusOptions = statesAsOptions(orderStateMachine);

// =============================================================================
// Entity Configuration
// =============================================================================

export const orderEntity: EntityConfig<Order> = {
  name: "order",
  table: "orders",
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

  defaultSort: { column: "order_date", direction: "desc" },
  searchableFields: ["order_number"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "order_number",
    badge: "status",
  },

  detailSections: [
    {
      id: "quick-links",
      title: "Quick Actions",
      component: OrderQuickLinks,
    },
    {
      id: "overview",
      title: "Overview",
      fields: [
        { field: "order_number", label: "Order Number" },
        { field: "status", label: "Status" },
        { field: "order_date", label: "Order Date", format: "date" },
        { field: "requested_date", label: "Requested Date", format: "date" },
        { field: "scheduled_date", label: "Scheduled Date", format: "date" },
        { field: "fulfilled_date", label: "Fulfilled Date", format: "date" },
      ],
    },
    {
      id: "notes",
      title: "Notes",
      fields: [
        { field: "notes", label: "Notes", fullWidth: true },
      ],
      collapsible: true,
    },
    {
      id: "revision-history",
      title: "Revision History",
      component: createRevisionHistoryDisplay("orders"),
      collapsible: true,
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
      id: "revision-history",
      title: "Revision History",
      component: createRevisionHistoryDisplay("orders"),
      collapsible: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: orderSchema,

  formFields: [
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
      colSpan: 6,
    },
    {
      name: "order_date",
      label: "Order Date",
      type: "date",
      required: true,
      colSpan: 4,
    },
    {
      name: "requested_date",
      label: "Requested Delivery Date",
      type: "date",
      colSpan: 4,
    },
    {
      name: "scheduled_date",
      label: "Scheduled Delivery Date",
      type: "date",
      colSpan: 4,
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      placeholder: "Special instructions, delivery notes...",
      colSpan: 12,
    },
  ],

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
    },
    {
      name: "delivery",
      entity: "delivery",
      type: "belongsTo",
      foreignKey: "delivery_id",
      showInDetail: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show me all pending orders",
    "What orders are scheduled for this week?",
    "List orders for Downtown Distributors",
    "Find orders that need to be picked",
  ],

  keyFields: ["order_number", "status", "order_date", "customer_id"],
};
