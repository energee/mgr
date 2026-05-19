/**
 * Location Entity — presentation
 *
 * The React/UI half of the location entity: list columns, list filters, and
 * the unified detail/edit sections.
 */

import type { EntityPresentation } from "@/types/entity";
import { getValueLabel, valuesAsOptions } from "@/types/entity";
import { locationCore, locationTypeDisplayConfig, type LocationWithPos } from "./core";

export const locationPresentation: EntityPresentation<LocationWithPos> = {
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
      accessorKey: "location_type",
      header: "Type",
      sortable: true,
      render: (value: unknown) => getValueLabel(locationCore, "location_type", value as string),
    },
    {
      accessorKey: "is_primary",
      header: "Primary",
      sortable: true,
      render: (value: unknown) => (value ? "Yes" : "No"),
    },
    {
      accessorKey: "is_active",
      header: "Active",
      sortable: true,
      render: (value: unknown) => (value ? "Yes" : "No"),
    },
  ],

  listFilters: [
    {
      field: "location_type",
      type: "select",
      label: "Type",
      options: valuesAsOptions(locationTypeDisplayConfig),
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
      title: "Location Details",
      fields: [
        {
          name: "name",
          label: "Name",
          type: "text",
          placeholder: "e.g., Main Brewery, Downtown Taproom",
          required: true,
          colSpan: 6,
        },
        {
          name: "location_type",
          label: "Type",
          type: "select",
          options: valuesAsOptions(locationTypeDisplayConfig),
          dynamicOptions: {
            table: "enum_values",
            valueField: "value",
            labelField: "label",
            filter: { enum_type: "location_type" },
            orderBy: "sort_order",
          },
          required: true,
          colSpan: 6,
        },
        {
          name: "is_primary",
          label: "Primary Location",
          type: "switch",
          description: "Default location for new vessels and inventory",
          colSpan: 6,
        },
        {
          name: "is_active",
          label: "Active",
          type: "switch",
          description: "Inactive locations won't appear in dropdown menus",
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
    {
      id: "pos",
      title: "POS Integration",
      fields: [
        {
          name: "square_location_id",
          label: "Square Location ID",
          type: "text",
          placeholder: "e.g., LXXXXXXXXXXXXXXXXX",
          description: "The Square Location ID from your Square Dashboard",
          colSpan: 6,
        },
        {
          name: "pos_bin_id",
          label: "POS Inventory Bin",
          type: "relation",
          relation: {
            entity: "bin",
            displayField: "name",
          },
          description: "Finished goods in this bin will sync to Square at this location",
          colSpan: 6,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "delete",
      label: "Delete Location",
      icon: "trash",
      type: "dropdown",
      variant: "destructive",
      deleteMode: "hard",
    },
  ],
};
