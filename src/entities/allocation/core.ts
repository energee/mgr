/**
 * Allocation Entity — server-safe core
 *
 * The pure-data half of the allocation entity: identity, the zod form schema,
 * state machine, and AI metadata. No React imports — safe to import from
 * server route handlers and API routes.
 *
 * Allocations track all inventory movements using polymorphic source/destination.
 * This is the unified audit trail for raw materials, batches, and finished goods.
 *
 * Source types: inventory_lot, batch, finished_good, external
 * Destination types: batch, finished_good, order, taproom_sale, sample, adjustment, destruction, loss, transfer
 *
 * Lifecycle: planned -> pending_approval -> completed (or rejected/cancelled)
 */

import { z } from "zod";
import type { EntityCoreInput, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";

export type Allocation = Database["public"]["Tables"]["allocations"]["Row"];

// =============================================================================
// Constants
// =============================================================================

export const SOURCE_TYPES = [
  { value: "inventory_lot", label: "Inventory Lot" },
  { value: "batch", label: "Batch" },
  { value: "finished_good", label: "Finished Good" },
  { value: "external", label: "External" },
];

export const DESTINATION_TYPES = [
  { value: "batch", label: "Batch" },
  { value: "finished_good", label: "Finished Good" },
  { value: "order", label: "Order" },
  { value: "taproom_sale", label: "Taproom Sale" },
  { value: "sample", label: "Sample" },
  { value: "adjustment", label: "Adjustment" },
  { value: "destruction", label: "Destruction" },
  { value: "loss", label: "Loss" },
  { value: "transfer", label: "Transfer" },
];

export const REASON_CODES = [
  { value: "breakage", label: "Breakage" },
  { value: "sample_customer", label: "Customer Sample" },
  { value: "sample_quality", label: "Quality Sample" },
  { value: "contamination", label: "Contamination" },
  { value: "expired", label: "Expired" },
  { value: "spillage", label: "Spillage" },
  { value: "theft", label: "Theft" },
  { value: "count_adjustment", label: "Count Adjustment" },
  // Auto-inserted by reconcileBatchLoss at batch completion (packaged vs
  // produced wort). Keep value in sync with the service's insert literal.
  { value: "reconciliation", label: "Completion Reconciliation" },
  // Auto-inserted by the Square refund webhook (00241) as the inverse
  // adjustment reversing a refunded taproom_sale. Keep value in sync with the
  // webhook's insert literal (src/app/api/square/webhook/route.ts).
  { value: "refund", label: "POS Refund" },
  { value: "other", label: "Other" },
];

// =============================================================================
// Zod Schema
// =============================================================================

export const allocationSchema = z.object({
  source_type: z.enum(["inventory_lot", "batch", "finished_good", "external"]),
  source_id: z.string().uuid().nullable().optional(),
  destination_type: z.enum([
    "batch",
    "finished_good",
    "order",
    "taproom_sale",
    "sample",
    "adjustment",
    "destruction",
    "loss",
    "transfer",
  ]),
  destination_id: z.string().uuid().nullable().optional(),
  quantity: z.coerce.number().positive("Quantity must be positive"),
  volume_bbl: z.coerce.number().nonnegative().nullable().optional(),
  unit_cost: z.coerce.number().nonnegative().nullable().optional(),
  status: z.string().default("planned"),
  reason_code: z.string().nullable().optional(),
  lot_number: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  requires_approval: z.boolean().default(false),
});

export type AllocationFormValues = z.infer<typeof allocationSchema>;

// =============================================================================
// State Machine
// =============================================================================

export const allocationStateMachine: StateMachineConfig<Allocation> = {
  stateField: "status",
  states: ["planned", "pending_approval", "completed", "rejected", "cancelled"],
  initialState: "planned",
  transitions: {
    planned: ["pending_approval", "completed", "cancelled"],
    pending_approval: ["completed", "rejected"],
    completed: [],
    rejected: [],
    cancelled: [],
  },
  stateDisplay: {
    planned: { label: "Planned", color: "default" },
    pending_approval: { label: "Pending Approval", color: "warning" },
    completed: { label: "Completed", color: "success" },
    rejected: { label: "Rejected", color: "error" },
    cancelled: { label: "Cancelled", color: "default" },
  },
};

export const statusOptions = statesAsOptions(allocationStateMachine);

// =============================================================================
// Entity Core
// =============================================================================

export const allocationCore: EntityCoreInput<Allocation> = {
  name: "allocation",
  table: "allocations",
  displayName: "Allocation",
  domain: "inventory",

  // Explicit: sort by most-recent first, not by name.
  defaultSort: { column: "created_at", direction: "desc" },
  searchableFields: ["lot_number", "notes"],

  detailHeader: {
    title: "id",
    badge: "status",
  },

  formSchema: allocationSchema,

  stateMachine: allocationStateMachine,

  relations: [
    // Note: Polymorphic relations are handled specially in the application
    // These are placeholders for documentation purposes
  ],

  keyFields: [
    "source_type",
    "source_id",
    "destination_type",
    "destination_id",
    "status",
    "quantity",
    "reason_code",
  ],
};
