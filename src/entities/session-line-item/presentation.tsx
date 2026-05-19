/**
 * Session Line Item Entity — presentation
 *
 * The React/UI half of the session line item entity: list columns, list
 * filters, and the unified detail/edit sections.
 */

import type { EntityPresentation } from "@/types/entity";
import type { SessionLineItem } from "./core";

export const sessionLineItemPresentation: EntityPresentation<SessionLineItem> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "brand_id",
      header: "Brand",
      sortable: true,
      relation: {
        entity: "brand",
        displayField: "name",
      },
    },
    {
      accessorKey: "selling_format_id",
      header: "Selling Format",
      sortable: true,
      relation: {
        entity: "selling_format",
        displayField: "name",
      },
    },
    {
      accessorKey: "planned_quantity",
      header: "Planned",
      sortable: true,
      render: (value) => value ? `${value}` : "—",
    },
    {
      accessorKey: "actual_quantity",
      header: "Actual",
      sortable: true,
      render: (value) => value ? `${value}` : "—",
    },
  ],

  listFilters: [],

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Line Item Details",
      fields: [
        {
          name: "brand_id",
          label: "Brand",
          type: "select",
          required: true,
          colSpan: 6,
          dynamicOptions: {
            table: "brands",
            valueField: "id",
            labelField: "name",
            orderBy: "name",
          },
        },
        {
          name: "selling_format_id",
          label: "Selling Format",
          type: "relation",
          colSpan: 6,
          relation: { entity: "selling_format", displayField: "name" },
        },
        {
          name: "keg_owner_id",
          label: "Keg Owner",
          type: "relation",
          colSpan: 6,
          relation: { entity: "keg_owner", displayField: "name" },
          description: "Fleet owner for keg packaging",
        },
        {
          name: "planned_quantity",
          label: "Planned Quantity",
          type: "number",
          placeholder: "Units to package",
          colSpan: 6,
        },
        {
          name: "actual_quantity",
          label: "Actual Quantity",
          type: "number",
          placeholder: "Actual units packaged",
          colSpan: 6,
        },
        {
          name: "created_at",
          label: "Created",
          format: "datetime",
          editable: false,
          colSpan: 6,
        },
      ],
    },
  ],
};
