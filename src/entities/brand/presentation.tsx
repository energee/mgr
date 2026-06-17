/**
 * Brand Entity — presentation
 *
 * The React/UI half of the brand entity: list columns, list filters, and the
 * unified detail/edit sections.
 */

import type { EntityPresentation } from "@/types/entity";
import type { Brand } from "./core";

export const brandPresentation: EntityPresentation<Brand> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "name",
      header: "Name",
      sortable: true,
    },
    {
      accessorKey: "variant",
      header: "Variant",
      sortable: true,
    },
    {
      accessorKey: "style_id",
      header: "Style",
      sortable: true,
      relation: {
        entity: "beer_style",
        displayField: "name",
      },
    },
    {
      accessorKey: "abv",
      header: "ABV",
      sortable: true,
      render: (value) => (value ? `${value}%` : "—"),
    },
  ],

  listFilters: [
    {
      field: "style_id",
      type: "select",
      label: "Style",
      dynamicOptions: {
        table: "beer_styles",
        valueField: "id",
        labelField: "name",
        orderBy: "name",
      },
    },
  ],

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Brand Information",
      fields: [
        {
          name: "name",
          label: "Name",
          type: "text",
          placeholder: "e.g., Hop Highway",
          required: true,
          colSpan: 6,
        },
        {
          name: "variant",
          label: "Variant",
          type: "text",
          placeholder: "e.g., Session, Double, Nitro",
          colSpan: 6,
        },
        {
          name: "style_id",
          label: "Style",
          type: "relation",
          relation: {
            entity: "beer_style",
            displayField: "name",
          },
          colSpan: 6,
        },
        {
          name: "abv",
          label: "ABV",
          type: "number",
          placeholder: "e.g., 6.5",
          render: (v) => (v ? `${v}%` : "—"),
          colSpan: 6,
        },
      ],
    },
    {
      id: "description",
      title: "Description",
      fields: [
        {
          name: "description",
          label: "Description",
          type: "textarea",
          placeholder: "Beer description, tasting notes, etc.",
          fullWidth: true,
        },
      ],
    },
    {
      id: "untappd",
      title: "Untappd",
      collapsible: true,
      fields: [
        {
          name: "untappd_url",
          label: "Untappd URL",
          type: "text",
          placeholder: "https://untappd.com/b/...",
          colSpan: 6,
        },
        {
          name: "untappd_rating",
          label: "Rating",
          editable: false,
          colSpan: 6,
        },
      ],
    },
  ],
};
