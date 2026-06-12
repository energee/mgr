/**
 * Purchase Order Entity Configuration
 *
 * Purchase orders track ingredient and material orders to suppliers.
 * Lifecycle: draft → submitted → confirmed → partial → fulfilled → closed
 *
 * Line items are edited inline on the detail page (POLineItemsEditor) while
 * the PO is in draft. The partial/fulfilled states are normally reached
 * through the "Receive Items" flow (POReceiving, intercepted by
 * pos/[id]/page.tsx), which records po_receives rows and derives the target
 * state from received totals.
 */

import { z } from "zod";
import type { EntityConfig, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { StatusBadge } from "@/components/universal/status-badge";
import { createRevisionHistoryDisplay } from "@/components/domain/shared/revision-history-display";
import { createQBOSyncDisplay } from "@/components/domain/shared/qbo-sync-section";
import { POLineItemsEditor } from "@/components/domain/purchasing/po-line-items-editor";

type PurchaseOrder = Database["public"]["Tables"]["purchase_orders"]["Row"];

// Wrapper adapting POLineItemsEditor ({ poId, readOnly }) to the relation
// component interface ({ parentId, data }) — same pattern as order.tsx
// OrderItemsRelation. Line items are editable only while the PO is in draft;
// once submitted, the supplier-facing document is locked.
function POLineItemsRelation({
  parentId,
  data,
}: {
  parentId: string;
  data?: Record<string, unknown>;
}) {
  return <POLineItemsEditor poId={parentId} readOnly={data?.status !== "draft"} />;
}

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

const purchaseOrderStateMachine: StateMachineConfig<PurchaseOrder> = {
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
  // NOTE: partial/fulfilled are normally reached via the "Receive Items"
  // action (POReceiving computes the target from received totals). They are
  // deliberately NOT listed in `requiresAction`: that mechanism requires the
  // named action to carry a fixed `toState` (see requires-action.test.ts),
  // which an interception action with a dynamic target cannot provide. Raw
  // "Move to Partial/Fulfilled" items therefore remain available as a manual
  // escape hatch (e.g. closing out a PO without per-line receipts).
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

const statusOptions = statesAsOptions(purchaseOrderStateMachine);

// =============================================================================
// Entity Configuration
// =============================================================================

export const purchaseOrderEntity: EntityConfig<PurchaseOrder> = {
  name: "purchase_order",
  table: "purchase_orders",
  displayName: "Purchase Order",
  displayNamePlural: "Purchase Orders",
  description: "Purchase orders to suppliers for ingredients and materials",
  domain: "purchasing",
  basePath: "/purchasing/pos",

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
          config={purchaseOrderEntity.stateMachine?.stateDisplay}
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

  defaultSort: { column: "order_date", direction: "desc" },
  searchableFields: ["po_number"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "po_number",
    badge: "status",
  },

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        {
          // Prefilled by pos/new/page.tsx with the next PO-YYYY-NNN suggestion
          // from generate_next_po_number() (migration 00142) — the same
          // sequence the automated demand→PO flow uses. Stays editable; the
          // po_number UNIQUE constraint backstops concurrent suggestions.
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
      // hideOnCreate: sync status only exists for persisted POs.
      id: "qbo-sync",
      title: "QuickBooks",
      component: createQBOSyncDisplay("purchase_order"),
      hideOnCreate: true,
    },
    {
      // hideOnCreate: no revisions before the first save.
      id: "revision-history",
      title: "Revision History",
      component: createRevisionHistoryDisplay("purchase_orders"),
      collapsible: true,
      hideOnCreate: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: purchaseOrderSchema,

  // ---------------------------------------------------------------------------
  // State Machine
  // ---------------------------------------------------------------------------
  stateMachine: purchaseOrderStateMachine,

  // Framework Duplicate action (EntityDetailUnified): carries over supplier,
  // costs and notes. po_number is identity, and dates would silently go stale
  // on the copy; status/id/audit/version are excluded by the framework
  // baseline (see buildDuplicateDefaults).
  excludeOnDuplicate: ["po_number", "order_date", "expected_date", "submitted_at"],

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
      // Intercepted by pos/[id]/page.tsx handleAction → opens the POReceiving
      // bulk-receive dialog, which inserts po_receives rows and flips the PO
      // to partial or fulfilled based on received totals. Replaces the former
      // bare mark_partial/fulfill transition buttons. Not offered from
      // "submitted": submitted → partial/fulfilled is not a legal transition.
      name: "receive_items",
      label: "Receive Items",
      icon: "package",
      type: "button",
      fromStates: ["confirmed", "partial"],
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
      // Inline editor replaces the generic RelationTable (and its Add link —
      // po_line_item is an inline-only entity with no create route).
      component: POLineItemsRelation,
    },
  ],
};
