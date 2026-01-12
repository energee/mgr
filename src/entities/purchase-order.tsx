/**
 * Purchase Order Entity Configuration
 *
 * Manages purchase orders to suppliers with state machine workflow:
 * draft → submitted → confirmed → partial/fulfilled
 */

import { z } from "zod";
import type { EntityConfig, StateMachineConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";

type PurchaseOrder = Database["public"]["Tables"]["purchase_orders"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const purchaseOrderSchema = z.object({
  po_number: z.string().min(1, "PO number is required"),
  supplier_id: z.string().uuid("Invalid supplier"),
  order_date: z.string().min(1, "Order date is required"),
  expected_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type PurchaseOrderFormValues = z.infer<typeof purchaseOrderSchema>;

// =============================================================================
// State Machine
// =============================================================================

const purchaseOrderStateMachine: StateMachineConfig<PurchaseOrder> = {
  stateField: "status",
  states: ["draft", "submitted", "confirmed", "partial", "fulfilled", "cancelled"],
  initialState: "draft",
  transitions: {
    draft: ["submitted", "cancelled"],
    submitted: ["confirmed", "cancelled"],
    confirmed: ["partial", "fulfilled", "cancelled"],
    partial: ["fulfilled", "cancelled"],
    fulfilled: [],
    cancelled: [],
  },
};

// =============================================================================
// Entity Configuration
// =============================================================================

export const purchaseOrderEntity: EntityConfig<PurchaseOrder> = {
  name: "purchase_order",
  table: "purchase_orders",
  displayName: "Purchase Order",
  displayNamePlural: "Purchase Orders",
  description: "Purchase orders to suppliers for raw materials",
  domain: "purchasing",

  // ---------------------------------------------------------------------------
  // State Machine
  // ---------------------------------------------------------------------------
  stateMachine: purchaseOrderStateMachine,

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
      accessorKey: "supplier_id",
      header: "Supplier",
      sortable: true,
      relation: {
        entity: "supplier",
        displayField: "name",
      },
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
    {
      accessorKey: "status",
      header: "Status",
      sortable: true,
    },
  ],

  listFilters: [
    {
      field: "status",
      type: "select",
      label: "Status",
      options: [
        { value: "draft", label: "Draft" },
        { value: "submitted", label: "Submitted" },
        { value: "confirmed", label: "Confirmed" },
        { value: "partial", label: "Partial" },
        { value: "fulfilled", label: "Fulfilled" },
        { value: "cancelled", label: "Cancelled" },
      ],
    },
  ],

  defaultSort: { column: "order_date", direction: "desc" },
  searchableFields: ["po_number"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "po_number",
    badge: "status",
  },

  detailSections: [
    {
      id: "overview",
      title: "Order Details",
      fields: [
        { field: "po_number", label: "PO Number" },
        { field: "supplier_id", label: "Supplier" },
        { field: "order_date", label: "Order Date", format: "date" },
        { field: "expected_date", label: "Expected Date", format: "date" },
        { field: "status", label: "Status" },
      ],
    },
    {
      id: "notes",
      title: "Notes",
      fields: [{ field: "notes", label: "Notes", fullWidth: true }],
      collapsible: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: purchaseOrderSchema,

  formFields: [
    {
      name: "po_number",
      label: "PO Number",
      type: "text",
      placeholder: "e.g., PO-2024-001",
      required: true,
      colSpan: 6,
    },
    {
      name: "supplier_id",
      label: "Supplier",
      type: "relation",
      relation: { entity: "supplier", displayField: "name" },
      required: true,
      colSpan: 6,
    },
    {
      name: "order_date",
      label: "Order Date",
      type: "date",
      required: true,
      colSpan: 6,
    },
    {
      name: "expected_date",
      label: "Expected Delivery Date",
      type: "date",
      colSpan: 6,
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      placeholder: "Additional notes...",
      colSpan: 12,
    },
  ],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "submit",
      label: "Submit to Supplier",
      type: "button",
      fromStates: ["draft"],
      toState: "submitted",
      confirm: true,
    },
    {
      name: "confirm",
      label: "Mark Confirmed",
      type: "button",
      fromStates: ["submitted"],
      toState: "confirmed",
      confirm: true,
    },
    {
      name: "cancel",
      label: "Cancel",
      type: "dropdown",
      fromStates: ["draft", "submitted", "confirmed", "partial"],
      toState: "cancelled",
      confirm: true,
      variant: "destructive",
    },
  ],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "List open purchase orders",
    "Show POs awaiting delivery",
    "Find POs for supplier X",
    "What POs are past their expected date?",
  ],

  keyFields: ["po_number", "supplier_id", "status", "order_date", "expected_date"],
};
