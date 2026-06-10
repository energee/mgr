/**
 * PO Receive Entity Configuration
 *
 * PO receives track partial receipts against purchase order line items.
 * Each receive can create an inventory lot with lot number and expiration.
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
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "lot_number",
  },

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Receipt Information",
      fields: [
        {
          name: "po_line_item_id",
          label: "PO Line Item",
          type: "relation",
          relation: { entity: "po_line_item", displayField: "id" },
          required: true,
          colSpan: 12,
        },
        {
          name: "quantity",
          label: "Quantity Received",
          type: "number",
          required: true,
          colSpan: 4,
        },
        {
          name: "lot_number",
          label: "Lot Number",
          type: "text",
          placeholder: "Supplier's lot number",
          colSpan: 4,
        },
        {
          name: "received_date",
          label: "Received Date",
          type: "date",
          format: "date",
          colSpan: 4,
        },
        {
          name: "expiration_date",
          label: "Expiration Date",
          type: "date",
          format: "date",
          colSpan: 6,
        },
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
          placeholder: "Quality notes, discrepancies...",
          fullWidth: true,
          colSpan: 12,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
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
