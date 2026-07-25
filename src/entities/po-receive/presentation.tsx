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
    },
    {
      accessorKey: "lot_number",
      header: "Lot #",
    },
    {
      accessorKey: "received_date",
      header: "Received",
      format: "date",
    },
    {
      accessorKey: "expiration_date",
      header: "Expires",
      format: "date",
    },
  ],

};
