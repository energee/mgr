/**
 * Location Transfer Entity — server-safe core
 *
 * The pure-data half of the location transfer entity: identity, the zod form
 * schema, state machine, and AI metadata. No React imports — safe to import
 * from server route handlers and API routes.
 *
 * Tracks inventory movements between bins/locations. Unlike vessel transfers
 * (which move batches between vessels), location transfers move finished goods
 * and raw materials between storage bins across locations.
 *
 * Lifecycle: planned -> in_transit -> completed (cancelled from planned/in_transit)
 * Partial shipments: planned -> partial (auto-creates remainder transfer for unshipped lines)
 */

import { z } from "zod";
import type { EntityCoreInput, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";

// =============================================================================
// Types
// =============================================================================

export type LocationTransferView = {
  id: string;
  from_bin_id: string;
  to_bin_id: string;
  status: string;
  ship_date: string | null;
  receive_date: string | null;
  shipped_by: string | null;
  received_by: string | null;
  delivery_id: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  // Computed fields from location_transfers_with_details view
  from_bin_name: string | null;
  from_location_name: string | null;
  to_bin_name: string | null;
  to_location_name: string | null;
  delivery_number: string | null;
  lines_count: number | null;
};

// =============================================================================
// Zod Schema
// =============================================================================

export const locationTransferSchema = z
  .object({
    from_bin_id: z.string().uuid("Source bin is required"),
    to_bin_id: z.string().uuid("Destination bin is required"),
    delivery_id: z.string().uuid().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .refine((data) => data.from_bin_id !== data.to_bin_id, {
    message: "Cannot transfer to the same bin",
    path: ["to_bin_id"],
  });

export type LocationTransferFormValues = z.infer<typeof locationTransferSchema>;

// =============================================================================
// State Machine
// =============================================================================

export const locationTransferStateMachine: StateMachineConfig<LocationTransferView> = {
  stateField: "status",
  states: ["planned", "in_transit", "partial", "completed", "cancelled"],
  initialState: "planned",
  transitions: {
    planned: ["in_transit", "partial", "cancelled"],
    in_transit: ["completed", "cancelled"],
    partial: [],
    completed: [],
    cancelled: [],
  },
  stateDisplay: {
    planned: { label: "Planned", color: "default" },
    in_transit: { label: "In Transit", color: "info" },
    partial: { label: "Partially Shipped", color: "warning" },
    completed: { label: "Completed", color: "success" },
    cancelled: { label: "Cancelled", color: "error" },
  },
};

export const statusOptions = statesAsOptions(locationTransferStateMachine);

// =============================================================================
// Entity Core
// =============================================================================

export const locationTransferCore: EntityCoreInput<LocationTransferView> = {
  name: "location_transfer",
  table: "location_transfers",
  viewTable: "location_transfers_with_details",
  displayName: "Location Transfer",
  description:
    "Inventory movements between bins and locations for multi-site operations",
  domain: "inventory",
  basePath: "/inventory/transfers",

  defaultSort: {
    column: "ship_date",
    direction: "desc",
  },
  searchableFields: [
    "notes",
    "delivery_number" as keyof LocationTransferView & string,
  ],

  detailHeader: {
    title: "from_location_name" as keyof LocationTransferView & string,
    subtitle: "to_location_name" as keyof LocationTransferView & string,
    badge: "status",
  },

  formSchema: locationTransferSchema,

  stateMachine: locationTransferStateMachine,

  relations: [
    {
      name: "delivery",
      entity: "delivery",
      type: "belongsTo",
      foreignKey: "delivery_id",
      showInDetail: true,
    },
    {
      name: "transfer_lines",
      entity: "transfer_line",
      type: "hasMany",
      foreignKey: "transfer_id",
      showInDetail: true,
      detailTab: "Lines",
      // Lines are managed inline on the transfer detail page, not via a route.
      hideAdd: true,
    },
  ],

  queryExamples: [
    "Show me all planned location transfers",
    "What transfers are currently in transit?",
    "Find transfers from the main warehouse",
    "List completed transfers for this week",
  ],

  keyFields: [
    "status",
    "from_bin_id",
    "to_bin_id",
    "ship_date",
    "delivery_id",
  ],
};
