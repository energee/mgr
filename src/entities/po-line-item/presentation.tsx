/**
 * PO Line Item Entity — presentation
 *
 * The React/UI half of the PO line item entity: list columns and the unified
 * detail/edit sections.
 */

import type { EntityPresentation } from "@/types/entity";
import type { POLineItem } from "./core";
import { CATALOG_TYPES } from "./core";

export const poLineItemPresentation: EntityPresentation<POLineItem> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "catalog_type",
      header: "Type",
      sortable: true,
    },
    {
      accessorKey: "catalog_id",
      header: "Item",
    },
    {
      accessorKey: "quantity",
      header: "Qty",
      sortable: true,
    },
    {
      accessorKey: "received_quantity",
      header: "Received",
      sortable: true,
    },
    {
      accessorKey: "outstanding_quantity",
      header: "Outstanding",
      sortable: true,
    },
    {
      accessorKey: "unit",
      header: "Unit",
    },
    {
      accessorKey: "unit_price",
      header: "Unit Price",
      format: "currency",
    },
  ],

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Line Item Details",
      fields: [
        {
          name: "po_id",
          label: "Purchase Order",
          type: "relation",
          relation: { entity: "purchase_order", displayField: "po_number" },
          required: true,
          colSpan: 12,
        },
        {
          name: "catalog_type",
          label: "Item Type",
          type: "select",
          options: CATALOG_TYPES.map((t) => ({ value: t.value, label: t.label })),
          required: true,
          colSpan: 4,
        },
        {
          name: "catalog_id",
          label: "Item",
          type: "text",
          placeholder: "Select item type first",
          required: true,
          colSpan: 8,
        },
        {
          name: "quantity",
          label: "Quantity",
          type: "number",
          required: true,
          colSpan: 4,
        },
        {
          name: "unit",
          label: "Unit",
          type: "text",
          placeholder: "e.g., lb, oz, kg",
          required: true,
          colSpan: 4,
        },
        {
          name: "unit_price",
          label: "Unit Price",
          type: "number",
          format: "currency",
          placeholder: "0.00",
          colSpan: 4,
        },
      ],
    },
  ],
};
