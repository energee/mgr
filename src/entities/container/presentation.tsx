/**
 * Container Entity — presentation
 *
 * The React/UI half of the container entity: list columns, list filters, the
 * unified detail/edit sections, and actions.
 */

import type { EntityPresentation } from "@/types/entity";
import { deleteAction } from "@/types/entity";
import { CONTAINER_TYPE_OPTIONS } from "./core";
import type { Container } from "./core";

export const containerPresentation: EntityPresentation<Container> = {
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
      accessorKey: "type",
      header: "Type",
      sortable: true,
      render: (value) => {
        const option = CONTAINER_TYPE_OPTIONS.find((o) => o.value === value);
        return option?.label || String(value);
      },
    },
    {
      accessorKey: "volume_oz",
      header: "Volume (oz)",
      sortable: true,
      render: (value) => (value != null ? String(value) : "—"),
    },
    {
      accessorKey: "volume_bbl",
      header: "Volume",
      sortable: true,
      format: "unit",
      unitType: "volume",
    },
    {
      accessorKey: "deposit_amount",
      header: "Deposit",
      sortable: true,
      format: "currency",
    },
    {
      accessorKey: "is_active",
      header: "Active",
      sortable: true,
      render: (value) => (value ? "Yes" : "No"),
    },
  ],

  listFilters: [
    {
      field: "type",
      type: "select",
      label: "Type",
      options: CONTAINER_TYPE_OPTIONS,
    },
    {
      field: "is_active",
      type: "boolean",
      label: "Active",
    },
  ],

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Container Details",
      fields: [
        {
          name: "name",
          label: "Name",
          type: "text",
          placeholder: "e.g., 12oz Can, 1/2 Barrel",
          required: true,
          colSpan: 6,
        },
        {
          name: "type",
          label: "Type",
          type: "select",
          options: CONTAINER_TYPE_OPTIONS,
          required: true,
          colSpan: 6,
        },
        {
          name: "volume_oz",
          label: "Volume (oz)",
          type: "number",
          placeholder: "e.g., 12, 16, 128",
          description: "Volume in fluid ounces (for package containers)",
          colSpan: 4,
        },
        {
          name: "volume_bbl",
          label: "Volume",
          type: "unit",
          unitType: "volume",
          format: "unit",
          placeholder: "e.g., 0.5, 0.1667",
          description: "Volume in barrels for TTB reporting (for keg containers)",
          colSpan: 4,
        },
        {
          name: "deposit_amount",
          label: "Deposit",
          type: "number",
          format: "currency",
          placeholder: "e.g., 30.00",
          description: "Deposit charged to customers (kegs)",
          colSpan: 4,
        },
        {
          name: "position",
          label: "Display Order",
          type: "number",
          placeholder: "e.g., 10, 20, 30",
          description: "Order in dropdown menus (lower numbers appear first)",
          colSpan: 6,
        },
        {
          name: "is_active",
          label: "Active",
          type: "switch",
          description: "Inactive containers won't appear in dropdown menus",
          defaultValue: true,
          colSpan: 6,
        },
        {
          name: "created_at",
          label: "Created",
          format: "datetime",
          editable: false,
          colSpan: 6,
        },
        {
          name: "updated_at",
          label: "Last Updated",
          format: "datetime",
          editable: false,
          colSpan: 6,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [deleteAction("Container")],
};
