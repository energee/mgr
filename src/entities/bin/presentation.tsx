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
      id: "pos",
      title: "Point of Sale (Square)",
      fields: [
        {
          name: "square_location_id",
          label: "Square Location",
          type: "select",
          // No square_location entity to link to; dynamicOptions supplies the
          // picker (name -> square_location_id). Detail view shows the raw id.
          // Filtered to ACTIVE: a bin must not be mapped to a Square location
          // that Square has deactivated (its inventory pushes would 400). The
          // eq-filter also drops rows with a NULL status — the locations
          // refresh always writes Square's status, so those only exist for
          // rows synced before the column was populated; re-refresh to fix.
          dynamicOptions: {
            table: "square_locations",
            valueField: "square_location_id",
            labelField: "name",
            orderBy: "name",
            filter: { status: "ACTIVE" },
          },
          description:
            "Set BOTH this and the sales channel to make this bin sync its sellable stock to Square. Refresh the list under Settings → Integrations → Square.",
          colSpan: 6,
        },
        {
          name: "pos_sales_channel_id",
          label: "POS Sales Channel",
          type: "select",
          relation: { entity: "sales_channel", displayField: "name" },
          dynamicOptions: {
            table: "sales_channels",
            valueField: "id",
            labelField: "name",
            orderBy: "name",
            filter: { is_active: true },
          },
          description: "Catalog prices pushed for this bin use this channel's pricing.",
          colSpan: 6,
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
