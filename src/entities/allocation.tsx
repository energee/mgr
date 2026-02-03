/**
 * Allocation Entity Configuration
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
import type { EntityConfig, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { StatusBadge } from "@/components/universal/status-badge";

type Allocation = Database["public"]["Tables"]["allocations"]["Row"];

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

const allocationStateMachine: StateMachineConfig<Allocation> = {
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

const statusOptions = statesAsOptions(allocationStateMachine);

// =============================================================================
// Entity Configuration
// =============================================================================

export const allocationEntity: EntityConfig<Allocation> = {
  name: "allocation",
  table: "allocations",
  displayName: "Allocation",
  displayNamePlural: "Allocations",
  description:
    "Unified allocation table for all inventory movements. Tracks raw materials, batches, and finished goods.",
  domain: "inventory",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "status",
      header: "Status",
      sortable: true,
      render: (value) => (
        <StatusBadge
          status={value as string}
          config={allocationEntity.stateMachine?.stateDisplay}
        />
      ),
    },
    {
      accessorKey: "source_type",
      header: "Source",
      sortable: true,
      render: (value) => {
        const sourceType = SOURCE_TYPES.find((s) => s.value === value);
        return sourceType?.label || String(value);
      },
    },
    {
      accessorKey: "destination_type",
      header: "Destination",
      sortable: true,
      render: (value) => {
        const destType = DESTINATION_TYPES.find((d) => d.value === value);
        return destType?.label || String(value);
      },
    },
    {
      accessorKey: "quantity",
      header: "Quantity",
      sortable: true,
      format: "number",
    },
    {
      accessorKey: "created_at",
      header: "Created",
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
    {
      field: "source_type",
      type: "multiselect",
      label: "Source Type",
      options: SOURCE_TYPES,
    },
    {
      field: "destination_type",
      type: "multiselect",
      label: "Destination Type",
      options: DESTINATION_TYPES,
    },
  ],

  defaultSort: { column: "created_at", direction: "desc" },
  searchableFields: ["lot_number", "notes"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "id",
    badge: "status",
  },

  detailSections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        { field: "status", label: "Status" },
        { field: "source_type", label: "Source Type" },
        { field: "source_id", label: "Source ID" },
        { field: "destination_type", label: "Destination Type" },
        { field: "destination_id", label: "Destination ID" },
      ],
    },
    {
      id: "quantities",
      title: "Quantities",
      fields: [
        { field: "quantity", label: "Quantity", format: "number" },
        { field: "volume_bbl", label: "Volume (BBL)", format: "unit", unitType: "volume" },
        { field: "unit_cost", label: "Unit Cost", format: "currency" },
        { field: "lot_number", label: "Lot Number" },
      ],
    },
    {
      id: "reason",
      title: "Reason",
      fields: [
        { field: "reason_code", label: "Reason Code" },
        { field: "notes", label: "Notes", fullWidth: true },
      ],
      collapsible: true,
    },
    {
      id: "approval",
      title: "Approval",
      fields: [
        { field: "requires_approval", label: "Requires Approval" },
        { field: "approved_by", label: "Approved By" },
        { field: "approved_at", label: "Approved At", format: "datetime" },
        { field: "rejection_reason", label: "Rejection Reason", fullWidth: true },
      ],
      collapsible: true,
    },
    {
      id: "timestamps",
      title: "Timestamps",
      fields: [
        { field: "created_at", label: "Created", format: "datetime" },
        { field: "created_by", label: "Created By" },
        { field: "completed_at", label: "Completed", format: "datetime" },
        { field: "cancelled_at", label: "Cancelled", format: "datetime" },
        { field: "updated_at", label: "Updated", format: "datetime" },
      ],
      collapsible: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: allocationSchema,

  formFields: [
    {
      name: "source_type",
      label: "Source Type",
      type: "select",
      options: SOURCE_TYPES,
      required: true,
      colSpan: 6,
      description: "Where the inventory comes from",
    },
    {
      name: "source_id",
      label: "Source ID",
      type: "text",
      placeholder: "UUID of source record (optional for external)",
      colSpan: 6,
    },
    {
      name: "destination_type",
      label: "Destination Type",
      type: "select",
      options: DESTINATION_TYPES,
      required: true,
      colSpan: 6,
      description: "Where the inventory goes",
    },
    {
      name: "destination_id",
      label: "Destination ID",
      type: "text",
      placeholder: "UUID of destination record (optional)",
      colSpan: 6,
    },
    {
      name: "quantity",
      label: "Quantity",
      type: "number",
      required: true,
      placeholder: "e.g., 10",
      colSpan: 4,
      description: "Always positive",
    },
    {
      name: "volume_bbl",
      label: "Volume (BBL)",
      type: "unit",
      unitType: "volume",
      placeholder: "e.g., 5.5",
      colSpan: 4,
      description: "For TTB reporting",
    },
    {
      name: "unit_cost",
      label: "Unit Cost",
      type: "number",
      placeholder: "e.g., 2.50",
      colSpan: 4,
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      options: statusOptions,
      colSpan: 6,
    },
    {
      name: "requires_approval",
      label: "Requires Approval",
      type: "switch",
      colSpan: 6,
    },
    {
      name: "reason_code",
      label: "Reason Code",
      type: "select",
      options: REASON_CODES,
      colSpan: 6,
      description: "For samples, adjustments, losses, etc.",
    },
    {
      name: "lot_number",
      label: "Lot Number",
      type: "text",
      placeholder: "e.g., LOT-2024-001",
      colSpan: 6,
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      placeholder: "Additional details...",
      colSpan: 12,
    },
  ],

  // ---------------------------------------------------------------------------
  // State Machine
  // ---------------------------------------------------------------------------
  stateMachine: allocationStateMachine,

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "complete",
      label: "Complete",
      icon: "check",
      type: "button",
      fromStates: ["planned"],
      toState: "completed",
    },
    {
      name: "submit_for_approval",
      label: "Submit for Approval",
      icon: "send",
      type: "button",
      fromStates: ["planned"],
      toState: "pending_approval",
    },
    {
      name: "approve",
      label: "Approve",
      icon: "check-circle",
      type: "button",
      fromStates: ["pending_approval"],
      toState: "completed",
    },
    {
      name: "reject",
      label: "Reject",
      icon: "x-circle",
      type: "dropdown",
      variant: "destructive",
      fromStates: ["pending_approval"],
      toState: "rejected",
      confirm: true,
    },
    {
      name: "cancel",
      label: "Cancel",
      icon: "x",
      type: "dropdown",
      variant: "destructive",
      fromStates: ["planned"],
      toState: "cancelled",
      confirm: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    // Note: Polymorphic relations are handled specially in the application
    // These are placeholders for documentation purposes
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show me all pending allocations",
    "What allocations are awaiting approval?",
    "List allocations for a specific batch",
    "Find all sample allocations this month",
    "Get TTB-relevant allocations for reporting",
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
