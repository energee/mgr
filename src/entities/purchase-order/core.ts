/**
 * Purchase Order Entity — server-safe core
 *
 * The pure-data half of the purchase order entity: identity, the zod form
 * schema, state machine, and AI metadata. No React imports — safe to import
 * from server route handlers and API routes.
 *
 * Purchase orders track ingredient and material orders to suppliers.
 * Lifecycle: draft → submitted → confirmed → partial → fulfilled → closed
 */

import { z } from "zod";
import type { EntityCoreInput, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";

export type PurchaseOrder = Database["public"]["Tables"]["purchase_orders"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const purchaseOrderSchema = z.object({
  po_number: z.string().min(1, "PO number is required"),
  supplier_id: z.string().uuid().nullable().optional(),
  status: z.string().default("draft"),
  order_date: z.string().min(1, "Order date is required"),
  expected_date: z.string().nullable().optional(),
  shipping_cost: z.coerce.number().nullable().optional(),
  tax: z.coerce.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type PurchaseOrderFormValues = z.infer<typeof purchaseOrderSchema>;

// =============================================================================
// State Machine
// =============================================================================

export const purchaseOrderStateMachine: StateMachineConfig<PurchaseOrder> = {
  stateField: "status",
  states: ["draft", "submitted", "confirmed", "partial", "fulfilled", "cancelled", "closed"],
  initialState: "draft",
  transitions: {
    draft: ["submitted", "cancelled"],
    submitted: ["confirmed", "cancelled"],
    confirmed: ["partial", "fulfilled", "cancelled"],
    partial: ["fulfilled", "cancelled"],
    fulfilled: ["closed"],
    cancelled: [],
    closed: [],
  },
  stateDisplay: {
    draft: { label: "Draft", color: "default" },
    submitted: { label: "Submitted", color: "info" },
    confirmed: { label: "Confirmed", color: "info" },
    partial: { label: "Partial", color: "warning" },
    fulfilled: { label: "Fulfilled", color: "success" },
    cancelled: { label: "Cancelled", color: "error" },
    closed: { label: "Closed", color: "default" },
  },
};

export const statusOptions = statesAsOptions(purchaseOrderStateMachine);

// =============================================================================
// Entity Core
// =============================================================================

export const purchaseOrderCore: EntityCoreInput<PurchaseOrder> = {
  name: "purchase_order",
  table: "purchase_orders",
  displayName: "Purchase Order",
  domain: "purchasing",
  basePath: "/purchasing/pos",

  defaultSort: { column: "order_date", direction: "desc" },
  searchableFields: ["po_number"],

  detailHeader: {
    title: "po_number",
    badge: "status",
  },

  formSchema: purchaseOrderSchema,

  stateMachine: purchaseOrderStateMachine,

  relations: [
    {
      name: "supplier",
      entity: "supplier",
      type: "belongsTo",
      foreignKey: "supplier_id",
      showInDetail: true,
    },
    {
      name: "line_items",
      entity: "po_line_item",
      type: "hasMany",
      foreignKey: "po_id",
      showInDetail: true,
      detailTab: "Line Items",
    },
  ],

  keyFields: ["po_number", "status", "supplier_id", "order_date", "expected_date"],
};
