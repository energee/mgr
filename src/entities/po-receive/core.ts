/**
 * PO Receive Entity — server-safe core
 *
 * The pure-data half of the PO receive entity: identity, the zod form schema,
 * relations, and AI metadata. No React imports — safe to import from server
 * route handlers and API routes.
 *
 * PO receives track partial receipts against purchase order line items.
 * Each receive can create an inventory lot with lot number and expiration.
 */

import { z } from "zod";
import type { EntityCoreInput } from "@/types/entity";
import type { Database } from "@/types/supabase";

// =============================================================================
// Types
// =============================================================================

export type POReceive = Database["public"]["Tables"]["po_receives"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const poReceiveSchema = z.object({
  po_line_item_id: z.string().uuid("PO line item is required"),
  quantity: z.coerce.number().positive("Quantity must be greater than zero"),
  lot_number: z.string().nullable().optional(),
  expiration_date: z.string().nullable().optional(),
  received_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type POReceiveFormValues = z.infer<typeof poReceiveSchema>;

// =============================================================================
// Entity Core
// =============================================================================

export const poReceiveCore: EntityCoreInput<POReceive> = {
  name: "po_receive",
  table: "po_receives",
  displayName: "PO Receive",
  domain: "purchasing",
  // Inline-only: receipts are recorded through the PO accept-inventory flow.
  basePath: null,

  // Explicit: sort by received date descending, not by name.
  defaultSort: { column: "received_date", direction: "desc" },
  searchableFields: ["lot_number", "notes"],


  formSchema: poReceiveSchema,

  relations: [
    {
      name: "po_line_item",
      entity: "po_line_item",
      type: "belongsTo",
      foreignKey: "po_line_item_id",
      showInDetail: true,
    },
  ],

  keyFields: ["po_line_item_id", "quantity", "lot_number", "received_date"],
};
