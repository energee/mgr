/**
 * Location Transfer Entity Configuration
 *
 * Tracks inventory movements between bins/locations. Unlike vessel transfers
 * (which move batches between vessels), location transfers move finished goods
 * and raw materials between storage bins across locations.
 *
 * Lifecycle: planned -> in_transit -> completed (cancelled from planned/in_transit)
 */

import { z } from "zod";
import type { EntityConfig, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";
import { StatusBadge } from "@/components/universal/status-badge";

// =============================================================================
// Types
// =============================================================================

interface LocationTransferView {
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
}

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

const locationTransferStateMachine: StateMachineConfig<LocationTransferView> = {
  stateField: "status",
  states: ["planned", "in_transit", "completed", "cancelled"],
  initialState: "planned",
  transitions: {
    planned: ["in_transit", "cancelled"],
    in_transit: ["completed", "cancelled"],
    completed: [],
    cancelled: [],
  },
  stateDisplay: {
    planned: { label: "Planned", color: "default" },
    in_transit: { label: "In Transit", color: "info" },
    completed: { label: "Completed", color: "success" },
    cancelled: { label: "Cancelled", color: "error" },
  },
};

const statusOptions = statesAsOptions(locationTransferStateMachine);

// =============================================================================
// Entity Configuration
// =============================================================================

export const locationTransferEntity: EntityConfig<LocationTransferView> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "location_transfer",
  table: "location_transfers",
  viewTable: "location_transfers_with_details",
  displayName: "Location Transfer",
  displayNamePlural: "Location Transfers",
  description:
    "Inventory movements between bins and locations for multi-site operations",
  domain: "inventory",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "from_location_name",
      header: "From",
      sortable: true,
      render: (_value, row) => {
        const data = row as LocationTransferView;
        if (data.from_location_name && data.from_bin_name) {
          return `${data.from_location_name} / ${data.from_bin_name}`;
        }
        return data.from_location_name || data.from_bin_name || "—";
      },
    },
    {
      accessorKey: "to_location_name",
      header: "To",
      sortable: true,
      render: (_value, row) => {
        const data = row as LocationTransferView;
        if (data.to_location_name && data.to_bin_name) {
          return `${data.to_location_name} / ${data.to_bin_name}`;
        }
        return data.to_location_name || data.to_bin_name || "—";
      },
    },
    {
      accessorKey: "lines_count",
      header: "Lines",
      sortable: true,
    },
    {
      accessorKey: "status",
      header: "Status",
      sortable: true,
      render: (value) => (
        <StatusBadge
          status={value as string}
          config={locationTransferEntity.stateMachine?.stateDisplay}
        />
      ),
    },
    {
      accessorKey: "ship_date",
      header: "Ship Date",
      sortable: true,
      format: "date",
    },
    {
      accessorKey: "delivery_number",
      header: "Delivery",
      sortable: true,
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

  defaultSort: {
    column: "created_at" as keyof LocationTransferView & string,
    direction: "desc",
  },
  searchableFields: [
    "notes",
    "delivery_number" as keyof LocationTransferView & string,
  ],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "from_location_name" as keyof LocationTransferView & string,
    subtitle: "to_location_name" as keyof LocationTransferView & string,
    badge: "status",
  },

  detailSections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        {
          field: "from_bin_id",
          label: "From Bin",
          relation: { entity: "bin", displayField: "name" },
        },
        {
          field: "from_location_name" as keyof LocationTransferView & string,
          label: "From Location",
        },
        {
          field: "to_bin_id",
          label: "To Bin",
          relation: { entity: "bin", displayField: "name" },
        },
        {
          field: "to_location_name" as keyof LocationTransferView & string,
          label: "To Location",
        },
        { field: "status", label: "Status" },
        {
          field: "lines_count" as keyof LocationTransferView & string,
          label: "Line Items",
        },
        {
          field: "delivery_number" as keyof LocationTransferView & string,
          label: "Delivery",
        },
      ],
    },
    {
      id: "shipping",
      title: "Shipping Details",
      fields: [
        { field: "ship_date", label: "Ship Date", format: "datetime" },
        { field: "shipped_by", label: "Shipped By" },
        { field: "receive_date", label: "Receive Date", format: "datetime" },
        { field: "received_by", label: "Received By" },
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
  // Unified Sections (for EntityDetailUnified)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        {
          name: "from_bin_id",
          label: "From Bin",
          type: "relation",
          relation: { entity: "bin", displayField: "name" },
          description: "Source bin to transfer from",
          required: true,
          colSpan: 6,
        },
        {
          name: "from_location_name" as keyof LocationTransferView & string,
          label: "From Location",
          editable: false,
          colSpan: 6,
        },
        {
          name: "to_bin_id",
          label: "To Bin",
          type: "relation",
          relation: { entity: "bin", displayField: "name" },
          description: "Destination bin to transfer to",
          required: true,
          colSpan: 6,
        },
        {
          name: "to_location_name" as keyof LocationTransferView & string,
          label: "To Location",
          editable: false,
          colSpan: 6,
        },
        {
          name: "status",
          label: "Status",
          editable: false,
          colSpan: 6,
        },
        {
          name: "lines_count" as keyof LocationTransferView & string,
          label: "Line Items",
          editable: false,
          colSpan: 3,
        },
        {
          name: "delivery_id",
          label: "Delivery",
          type: "relation",
          relation: { entity: "delivery", displayField: "delivery_number" },
          description: "Optional delivery run this transfer belongs to",
          colSpan: 6,
        },
      ],
    },
    {
      id: "shipping",
      title: "Shipping Details",
      fields: [
        { name: "ship_date", label: "Ship Date", format: "datetime", editable: false, colSpan: 6 },
        { name: "shipped_by", label: "Shipped By", editable: false, colSpan: 6 },
        { name: "receive_date", label: "Receive Date", format: "datetime", editable: false, colSpan: 6 },
        { name: "received_by", label: "Received By", editable: false, colSpan: 6 },
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
          placeholder: "Transfer instructions, special handling...",
          fullWidth: true,
          colSpan: 12,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: locationTransferSchema,

  formFields: [
    {
      name: "from_bin_id",
      label: "From Bin",
      type: "relation",
      relation: { entity: "bin", displayField: "name" },
      description: "Source bin to transfer from",
      required: true,
      colSpan: 6,
    },
    {
      name: "to_bin_id",
      label: "To Bin",
      type: "relation",
      relation: { entity: "bin", displayField: "name" },
      description: "Destination bin to transfer to",
      required: true,
      colSpan: 6,
    },
    {
      name: "delivery_id",
      label: "Delivery",
      type: "relation",
      relation: { entity: "delivery", displayField: "delivery_number" },
      description: "Optional delivery run this transfer belongs to",
      required: false,
      colSpan: 6,
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      placeholder: "Transfer instructions, special handling...",
      required: false,
      colSpan: 12,
    },
  ],

  // ---------------------------------------------------------------------------
  // State Machine
  // ---------------------------------------------------------------------------
  stateMachine: locationTransferStateMachine,

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "ship",
      label: "Ship",
      icon: "truck",
      type: "button",
      fromStates: ["planned"],
      toState: "in_transit",
    },
    {
      name: "receive",
      label: "Receive",
      icon: "package-check",
      type: "button",
      fromStates: ["in_transit"],
      toState: "completed",
    },
    {
      name: "cancel",
      label: "Cancel Transfer",
      icon: "x",
      type: "dropdown",
      variant: "destructive",
      fromStates: ["planned", "in_transit"],
      toState: "cancelled",
      confirm: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
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
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
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
