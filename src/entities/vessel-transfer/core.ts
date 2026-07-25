/**
 * Vessel Transfer Entity — server-safe core
 *
 * The pure-data half of the vessel transfer entity: identity, the zod form
 * schema, relations, and AI metadata. No React imports — safe to import from
 * server route handlers and API routes.
 *
 * Tracks batch movements between vessels throughout fermentation and
 * conditioning. Supports knockout from kettle (from_vessel_id = null),
 * FV to Brite transfers, Brite to Brite blending, and tank transfers.
 */

import { z } from "zod";
import type { EntityCoreInput } from "@/types/entity";
import type { Database } from "@/types/supabase";

// Use the view type since entity uses viewTable for queries
export type VesselTransfer = Database["public"]["Views"]["vessel_transfers_with_details"]["Row"];

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
// Entity Core
// =============================================================================

export const vesselTransferCore: EntityCoreInput<VesselTransfer> = {
  name: "vessel_transfer",
  table: "vessel_transfers",
  viewTable: "vessel_transfers_with_details",
  displayName: "Vessel Transfer",
  domain: "production",

  // Explicit: transfers are sorted by time, not name.
  defaultSort: { column: "transferred_at", direction: "desc" },
  searchableFields: ["notes"],

  detailHeader: {
    title: "to_vessel_name",
    subtitle: "transferred_at",
  },

  formSchema: vesselTransferSchema,

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

  keyFields: ["batch_id", "from_vessel_id", "to_vessel_id", "transferred_at", "volume_bbl"],
};
