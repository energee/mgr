/**
 * Vessel Transfer Entity Configuration
 *
 * Tracks batch movements between vessels throughout fermentation and conditioning.
 * Supports:
 * - Knockout from kettle (from_vessel_id = null)
 * - FV to Brite transfers
 * - Brite to Brite (blending)
 * - Tank transfers
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";

// Use the view type since entity uses viewTable for queries
type VesselTransfer = Database["public"]["Views"]["vessel_transfers_with_details"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const vesselTransferSchema = z.object({
  batch_id: z.string().uuid("Invalid batch ID"),
  from_vessel_id: z.string().uuid("Invalid vessel ID").nullable(),
  to_vessel_id: z.string().uuid("Invalid vessel ID").min(1, "Destination vessel is required"),
  volume_bbl: z.coerce.number().positive("Volume must be positive"),
  transferred_at: z.string().min(1, "Transfer date/time is required"),
  notes: z.string().nullable().optional(),
}).refine(
  (data) => !data.from_vessel_id || data.from_vessel_id !== data.to_vessel_id,
  {
    message: "Cannot transfer to the same vessel",
    path: ["to_vessel_id"],
  }
);

export type VesselTransferFormValues = z.infer<typeof vesselTransferSchema>;

// =============================================================================
// Entity Configuration
// =============================================================================

export const vesselTransferEntity: EntityConfig<VesselTransfer> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "vessel_transfer",
  table: "vessel_transfers",
  viewTable: "vessel_transfers_with_details",
  displayName: "Vessel Transfer",
  displayNamePlural: "Vessel Transfers",
  description: "Batch movements between vessels from knockout through packaging",
  domain: "production",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "batch_number",
      header: "Batch",
      sortable: true,
    },
    {
      accessorKey: "transferred_at",
      header: "Date/Time",
      sortable: true,
      format: "datetime",
    },
    {
      accessorKey: "from_vessel_name",
      header: "From",
      render: (value) => {
        if (!value) return "Kettle (knockout)";
        return String(value);
      },
    },
    {
      accessorKey: "to_vessel_name",
      header: "To",
    },
    {
      accessorKey: "volume_bbl",
      header: "Volume",
      sortable: true,
      format: "unit",
      unitType: "volume",
    },
    {
      accessorKey: "notes",
      header: "Notes",
    },
  ],

  defaultSort: { column: "transferred_at", direction: "desc" },
  searchableFields: ["notes"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "to_vessel_name",
    subtitle: "transferred_at",
  },

  detailSections: [
    {
      id: "overview",
      title: "Transfer Details",
      fields: [
        { field: "transferred_at", label: "Date/Time", format: "datetime" },
        { field: "from_vessel_id", label: "From Vessel", relation: { entity: "vessel", displayField: "name" } },
        { field: "to_vessel_id", label: "To Vessel", relation: { entity: "vessel", displayField: "name" } },
        { field: "volume_bbl", label: "Volume", format: "unit", unitType: "volume" },
        { field: "notes", label: "Notes" },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Unified Sections (for EntityDetailUnified)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Transfer Details",
      fields: [
        {
          name: "batch_id",
          label: "Batch",
          type: "relation",
          relation: { entity: "batch", displayField: "batch_number" },
          description: "Batch being transferred",
          required: true,
          colSpan: 12,
        },
        {
          name: "transferred_at",
          label: "Date/Time",
          type: "datetime",
          format: "datetime",
          description: "When the transfer occurred",
          required: true,
          defaultValue: () => new Date().toISOString(),
          colSpan: 6,
        },
        {
          name: "from_vessel_id",
          label: "From Vessel",
          type: "relation",
          relation: { entity: "vessel", displayField: "name" },
          description: "Source vessel (leave empty for knockout from kettle)",
          colSpan: 6,
        },
        {
          name: "to_vessel_id",
          label: "To Vessel",
          type: "relation",
          relation: { entity: "vessel", displayField: "name" },
          description: "Destination vessel",
          required: true,
          colSpan: 6,
        },
        {
          name: "volume_bbl",
          label: "Volume",
          type: "unit",
          unitType: "volume",
          format: "unit",
          description: "Volume transferred",
          required: true,
          colSpan: 6,
        },
        {
          name: "notes",
          label: "Notes",
          type: "textarea",
          description: "Additional notes about the transfer",
          colSpan: 12,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form Configuration
  // ---------------------------------------------------------------------------
  formSchema: vesselTransferSchema,

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "batch",
      entity: "batch",
      type: "belongsTo",
      foreignKey: "batch_id",
      showInDetail: true,
    },
    {
      name: "from_vessel",
      entity: "vessel",
      type: "belongsTo",
      foreignKey: "from_vessel_id",
      showInDetail: true,
    },
    {
      name: "to_vessel",
      entity: "vessel",
      type: "belongsTo",
      foreignKey: "to_vessel_id",
      showInDetail: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show me all transfers for batch B-2024-001",
    "What transfers happened this week?",
    "Find all knockouts to fermenter FV-01",
    "List transfers from brite tanks",
  ],

  keyFields: ["batch_id", "from_vessel_id", "to_vessel_id", "transferred_at", "volume_bbl"],
};
