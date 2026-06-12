/**
 * PO Receive Entity Configuration
 *
 * PO receives track partial receipts against purchase order line items.
 * Rows are created by the bulk "Receive Items" dialog on the purchase order
 * detail page (POReceiving) and consumed by the "Accept into Inventory" flow,
 * which turns unaccepted receives into inventory lots.
 *
 * Deliberately minimal: po_receive has no routes and no standalone detail or
 * edit form (no sections/detailHeader). The config exists for registry
 * metadata — chat read tools and the po_line_item "Receives" relation table.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";

type POReceive = Database["public"]["Tables"]["po_receives"]["Row"];

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
// Entity Configuration
// =============================================================================

export const poReceiveEntity: EntityConfig<POReceive> = {
  name: "po_receive",
  table: "po_receives",
  displayName: "PO Receive",
  displayNamePlural: "PO Receives",
  description: "Partial receipts against purchase order line items",
  domain: "purchasing",
  // Inline-only: receipts are recorded from the purchase order detail page.
  basePath: null,

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "po_line_item_id",
      header: "PO Line Item",
    },
    {
      accessorKey: "quantity",
      header: "Qty Received",
      sortable: true,
    },
    {
      accessorKey: "lot_number",
      header: "Lot #",
      sortable: true,
    },
    {
      accessorKey: "received_date",
      header: "Received",
      sortable: true,
      format: "date",
    },
    {
      accessorKey: "expiration_date",
      header: "Expires",
      sortable: true,
      format: "date",
    },
  ],

  defaultSort: { column: "received_date", direction: "desc" },
  searchableFields: ["lot_number", "notes"],

  // ---------------------------------------------------------------------------
  // Form (canonical insert shape — writes happen via POReceiving, not a
  // generic entity form; there are no sections to render one)
  // ---------------------------------------------------------------------------
  formSchema: poReceiveSchema,

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "po_line_item",
      entity: "po_line_item",
      type: "belongsTo",
      foreignKey: "po_line_item_id",
      showInDetail: true,
    },
  ],
};
