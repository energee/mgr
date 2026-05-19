/**
 * Order Item Entity — presentation
 *
 * The React/UI half of the order item entity: list columns and the unified
 * detail/edit sections.
 */

import type { EntityPresentation } from "@/types/entity";
import type { OrderItem } from "./core";

export const orderItemPresentation: EntityPresentation<OrderItem> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "brand_id",
      header: "Brand",
      relation: {
        entity: "brand",
        displayField: "name",
      },
    },
    {
      accessorKey: "style_id",
      header: "Style (TBD)",
      relation: {
        entity: "beer_style",
        displayField: "name",
      },
      render: (value, row) => {
        if (row.brand_id) return null; // Not TBD
        return value ? (
          <span className="text-muted-foreground italic">TBD: {String(value)}</span>
        ) : null;
      },
    },
    {
      accessorKey: "selling_format_id",
      header: "Format",
      relation: {
        entity: "selling_format",
        displayField: "name",
      },
    },
    {
      accessorKey: "quantity",
      header: "Qty",
      sortable: true,
    },
    {
      accessorKey: "unit_price",
      header: "Unit Price",
      format: "currency",
    },
    {
      accessorKey: "notes",
      header: "Notes",
    },
  ],

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Item Details",
      fields: [
        {
          name: "order_id",
          label: "Order",
          type: "relation",
          relation: { entity: "order", displayField: "order_number" },
          required: true,
          colSpan: 12,
        },
        {
          name: "brand_id",
          label: "Brand",
          type: "relation",
          relation: { entity: "brand", displayField: "name" },
          colSpan: 6,
        },
        {
          name: "style_id",
          label: "Style (for TBD)",
          type: "select",
          colSpan: 6,
          description: "Use when product is TBD - select the style category",
          dynamicOptions: {
            table: "beer_styles",
            valueField: "id",
            labelField: "name",
            orderBy: "category,name",
          },
        },
        {
          name: "tbd_notes",
          label: "TBD Notes",
          type: "textarea",
          colSpan: 12,
          placeholder: "Contract brew details, target specs, customer requirements...",
          description: "Details about the TBD product for planning purposes",
        },
        {
          name: "selling_format_id",
          label: "Selling Format",
          type: "relation",
          relation: { entity: "selling_format", displayField: "name" },
          colSpan: 6,
        },
        {
          name: "quantity",
          label: "Quantity",
          type: "number",
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
        {
          name: "batch_id",
          label: "Batch (optional)",
          type: "relation",
          relation: { entity: "batch", displayField: "batch_code" },
          colSpan: 4,
        },
        {
          name: "keg_owner_id",
          label: "Keg Owner (optional)",
          type: "relation",
          relation: { entity: "keg_owner", displayField: "name" },
          description: "Fleet owner for keg orders (picker uses this to select kegs)",
          colSpan: 6,
        },
        {
          name: "notes",
          label: "Notes",
          type: "textarea",
          colSpan: 12,
        },
      ],
    },
  ],
};
