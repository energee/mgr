/**
 * Pick List Entity — server-safe core
 *
 * The pure-data half of the pick list entity: identity, the zod form schema,
 * state machine, relations, and AI metadata. No React imports — safe to import
 * from server route handlers and API routes.
 *
 * Pick lists represent warehouse picking operations for order fulfillment.
 * They are generated from orders and track the physical picking process.
 *
 * Lifecycle: draft -> assigned -> in_progress -> completed (cancelled from any)
 */

import { z } from "zod";
import type { EntityCoreInput, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";

// =============================================================================
// Types
// =============================================================================

export type PickListView = {
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
};

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

export const pickListStateMachine: StateMachineConfig<PickListView> = {
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

export const statusOptions = statesAsOptions(pickListStateMachine);

// =============================================================================
// Entity Core
// =============================================================================

export const pickListCore: EntityCoreInput<PickListView> = {
  name: "pick_list",
  table: "pick_lists",
  viewTable: "pick_list_details",
  displayName: "Pick List",
  // displayNamePlural omitted — "Pick List"+"s" = "Pick Lists" matches exactly.
  description: "Warehouse pick lists for order fulfillment",
  domain: "sales",

  defaultSort: { column: "generated_at" as keyof PickListView & string, direction: "desc" },
  searchableFields: ["order_number" as keyof PickListView & string, "customer_name" as keyof PickListView & string],

  detailHeader: {
    title: "order_number" as keyof PickListView & string,
    subtitle: "customer_name" as keyof PickListView & string,
    badge: "status",
  },

  formSchema: pickListSchema,
  stateMachine: pickListStateMachine,

  relations: [
    {
      name: "order",
      entity: "order",
      type: "belongsTo",
      foreignKey: "order_id",
      showInDetail: true,
    },
  ],

  queryExamples: [
    "Show me all active pick lists",
    "What pick lists are assigned to John?",
    "Find incomplete pick lists for today",
    "Show pick lists for order ORD-2025-001",
  ],

  keyFields: ["order_number" as keyof PickListView & string, "status", "assigned_to_name" as keyof PickListView & string, "generated_at"],
};
