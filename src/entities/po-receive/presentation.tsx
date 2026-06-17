/**
 * PO Receive Entity — presentation
 *
 * The React/UI half of the PO receive entity: list columns and the unified
 * detail/edit sections.
 */

import type { EntityPresentation } from "@/types/entity";
import type { POReceive } from "./core";

export const poReceivePresentation: EntityPresentation<POReceive> = {
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
};
