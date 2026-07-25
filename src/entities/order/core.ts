/**
 * Order Entity — server-safe core
 *
 * The pure-data half of the order entity: identity, the zod form schema,
 * state machine, relations, and AI metadata. No React imports — safe to
 * import from server route handlers and API routes.
 *
 * Orders track sales from draft through fulfillment.
 * Lifecycle: draft → confirmed → scheduled → picking → packed → fulfilled
 */

import { z } from "zod";
import type { EntityCoreInput, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";

export type Order = Database["public"]["Tables"]["orders"]["Row"] & {
  // Joined from the order_list_details view for list/kanban/search display.
  customer_name?: string | null;
  // Sum of order_items (quantity * unit_price), computed by the view.
  total_amount?: number | null;
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
// State Machine
// =============================================================================

export const orderStateMachine: StateMachineConfig<Order> = {
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
  // Scheduling collects a delivery date via the schedule action dialog —
  // suppresses the bare "Move to Scheduled" so the date is always captured.
  requiresAction: {
    scheduled: "schedule",
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
export const statusOptions = statesAsOptions(orderStateMachine);

// =============================================================================
// Change Request Status Display
//
// Status display config for order_change_requests (not a standalone entity,
// but needs consistent status rendering via StatusBadge).
// =============================================================================

export const changeRequestStatusDisplay: Record<
  string,
  { label: string; color: "default" | "success" | "warning" | "error" | "info" }
> = {
  pending: { label: "Pending Review", color: "warning" },
  approved: { label: "Approved", color: "success" },
  rejected: { label: "Rejected", color: "error" },
  cancelled: { label: "Cancelled", color: "default" },
};

// =============================================================================
// Entity Core
// =============================================================================

export const orderCore: EntityCoreInput<Order> = {
  name: "order",
  table: "orders",
  // List/detail read from the view (joins customer_name for display + search).
  viewTable: "order_list_details",
  displayName: "Order",
  domain: "sales",

  // Explicit: sorted by most-recent order first.
  defaultSort: { column: "order_date", direction: "desc" },
  searchableFields: ["order_number", "customer_name"],

  stateMachine: orderStateMachine,

  detailHeader: {
    title: "order_number",
    badge: "status",
  },

  formSchema: orderSchema,

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
      // The `component` (OrderItemsRelation) is supplied by
      // presentation.tsx via `relationComponents` so this module stays
      // free of React imports.
    },
    {
      name: "pick_lists",
      entity: "pick_list",
      type: "hasMany",
      foreignKey: "order_id",
      showInDetail: true,
      detailTab: "Pick Lists",
      // pick_list has no create route — pick lists are generated, not added here.
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

  keyFields: ["order_number", "status", "order_date", "customer_id"],
};
