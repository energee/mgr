/**
 * Bin Entity — presentation
 *
 * The React/UI half of the bin entity: list columns, list filters, and the
 * unified detail/edit sections.
 */

import type { EntityPresentation } from "@/types/entity";
import { getValueLabel, valuesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { Badge } from "@/components/ui/badge";
import { binCore, binTypeDisplayConfig } from "./core";

type Bin = Database["public"]["Tables"]["bins"]["Row"];

// Bin type options derived from display config
const binTypeOptions = valuesAsOptions(binTypeDisplayConfig);

export const binPresentation: EntityPresentation<Bin> = {
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
      accessorKey: "location_name",
      header: "Location",
      sortable: true,
    },
    {
      accessorKey: "bin_type",
      header: "Type",
      sortable: true,
      render: (value) => (
        <Badge variant="outline">
          {getValueLabel(binCore, "bin_type", value as string)}
        </Badge>
      ),
    },
    {
      accessorKey: "capacity",
      header: "Capacity",
      sortable: true,
      format: "number",
    },
    {
      accessorKey: "total_item_count",
      header: "Items",
      sortable: true,
      format: "number",
    },
  ],

  listFilters: [
    {
      field: "bin_type",
      type: "select",
      label: "Type",
      options: binTypeOptions,
    },
    {
      field: "is_active",
      type: "boolean",
      label: "Active",
    },
  ],

  // ---------------------------------------------------------------------------
  // Unified Sections (for EntityDetailUnified)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Bin Details",
      fields: [
        {
          name: "name",
          label: "Name",
          type: "text",
          placeholder: "e.g., Shelf A-1, Cold Room 1",
          required: true,
          colSpan: 6,
        },
        {
          name: "location_id",
          label: "Location",
          type: "select",
          relation: { entity: "location", displayField: "name" },
          dynamicOptions: {
            table: "locations",
            valueField: "id",
            labelField: "name",
            orderBy: "name",
            filter: { is_active: true },
          },
          required: true,
          colSpan: 6,
        },
        {
          name: "bin_type",
          label: "Type",
          type: "select",
          options: binTypeOptions,
          required: true,
          colSpan: 6,
        },
        {
          name: "capacity",
          label: "Capacity",
          type: "number",
          format: "number",
          placeholder: "e.g., 100",
          description: "Maximum number of items this bin can hold",
          colSpan: 6,
        },
        {
          name: "is_active",
          label: "Active",
          type: "switch",
          description: "Inactive bins won't appear in dropdown menus",
          defaultValue: true,
          colSpan: 6,
        },
        {
          name: "is_default_fg",
          label: "Default finished-goods bin",
          type: "switch",
          description: "New finished goods land here when their packaging session has no bin set. At most one per location.",
          defaultValue: false,
          colSpan: 6,
        },
        {
          name: "notes",
          label: "Notes",
          type: "textarea",
          placeholder: "Any special notes about this bin...",
          fullWidth: true,
          colSpan: 12,
        },
      ],
    },
    {
      id: "contents_summary",
      title: "Contents Summary",
      fields: [
        { name: "fg_item_count" as keyof Bin & string, label: "Finished Goods Items", format: "number", editable: false, colSpan: 4 },
        { name: "rm_item_count" as keyof Bin & string, label: "Raw Material Items", format: "number", editable: false, colSpan: 4 },
        { name: "total_item_count" as keyof Bin & string, label: "Total Items", format: "number", editable: false, colSpan: 4 },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "delete",
      label: "Delete Bin",
      icon: "trash",
      type: "dropdown",
      variant: "destructive",
      deleteMode: "hard",
    },
  ],
};
