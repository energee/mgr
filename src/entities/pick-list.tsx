/**
 * Pick List Entity Configuration
 *
 * Pick lists represent warehouse picking operations for order fulfillment.
 * They are generated from orders and track the physical picking process.
 *
 * Lifecycle: draft -> assigned -> in_progress -> completed (cancelled from any)
 */

import { z } from "zod";
import type { EntityConfig, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";
import { StatusBadge } from "@/components/universal/status-badge";
import { PickListItems } from "@/components/domain/pick-list-items";

// =============================================================================
// Types
// =============================================================================

interface PickListView {
  id: string;
  order_id: string;
  status: string;
  generated_at: string;
  assigned_to: string | null;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
  order_number: string;
  customer_name: string | null;
  total_items: number;
  items_picked: number;
  assigned_to_name: string | null;
}

// =============================================================================
// Zod Schema
// =============================================================================

export const pickListSchema = z.object({
  order_id: z.string().uuid("Order is required"),
  status: z.string().default("draft"),
  assigned_to: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type PickListFormValues = z.infer<typeof pickListSchema>;

// =============================================================================
// State Machine
// =============================================================================

const pickListStateMachine: StateMachineConfig<PickListView> = {
  stateField: "status",
  states: ["draft", "assigned", "in_progress", "completed", "cancelled"],
  initialState: "draft",
  transitions: {
    draft: ["assigned", "cancelled"],
    assigned: ["in_progress", "cancelled"],
    in_progress: ["completed", "cancelled"],
    completed: [],
    cancelled: [],
  },
  stateDisplay: {
    draft: { label: "Draft", color: "default" },
    assigned: { label: "Assigned", color: "info" },
    in_progress: { label: "In Progress", color: "warning" },
    completed: { label: "Completed", color: "success" },
    cancelled: { label: "Cancelled", color: "error" },
  },
};

const statusOptions = statesAsOptions(pickListStateMachine);

// =============================================================================
// Entity Configuration
// =============================================================================

export const pickListEntity: EntityConfig<PickListView> = {
  name: "pick_list",
  table: "pick_lists",
  viewTable: "pick_list_details",
  displayName: "Pick List",
  displayNamePlural: "Pick Lists",
  description: "Warehouse pick lists for order fulfillment",
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
          config={pickListEntity.stateMachine?.stateDisplay}
        />
      ),
    },
    {
      accessorKey: "total_items",
      header: "Items",
      sortable: true,
      render: (value, row) => {
        const data = row as PickListView;
        return `${data.items_picked}/${data.total_items}`;
      },
    },
    {
      accessorKey: "assigned_to_name",
      header: "Assigned To",
      sortable: true,
    },
    {
      accessorKey: "generated_at",
      header: "Generated",
      sortable: true,
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

  defaultSort: { column: "generated_at" as keyof PickListView & string, direction: "desc" },
  searchableFields: ["order_number" as keyof PickListView & string, "customer_name" as keyof PickListView & string],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "order_number" as keyof PickListView & string,
    subtitle: "customer_name" as keyof PickListView & string,
    badge: "status",
  },

  detailSections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        { field: "order_number" as keyof PickListView & string, label: "Order Number" },
        { field: "customer_name" as keyof PickListView & string, label: "Customer" },
        { field: "status", label: "Status" },
        { field: "assigned_to_name" as keyof PickListView & string, label: "Assigned To" },
        { field: "generated_at", label: "Generated", format: "datetime" },
        { field: "started_at", label: "Started", format: "datetime" },
        { field: "completed_at", label: "Completed", format: "datetime" },
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
      fields: [
        { field: "notes", label: "Notes", fullWidth: true },
      ],
      collapsible: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: pickListSchema,

  formFields: [
    {
      name: "order_id",
      label: "Order",
      type: "relation",
      relation: {
        entity: "order",
        displayField: "order_number",
      },
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
      name: "assigned_to",
      label: "Assigned To",
      type: "relation",
      relation: {
        entity: "user_profile",
        displayField: "display_name",
      },
      colSpan: 6,
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      placeholder: "Picking instructions, special handling...",
      colSpan: 12,
    },
  ],

  // ---------------------------------------------------------------------------
  // State Machine
  // ---------------------------------------------------------------------------
  stateMachine: pickListStateMachine,

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

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "order",
      entity: "order",
      type: "belongsTo",
      foreignKey: "order_id",
      showInDetail: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show me all active pick lists",
    "What pick lists are assigned to John?",
    "Find incomplete pick lists for today",
    "Show pick lists for order ORD-2025-001",
  ],

  keyFields: ["order_number" as keyof PickListView & string, "status", "assigned_to_name" as keyof PickListView & string, "generated_at"],
};
