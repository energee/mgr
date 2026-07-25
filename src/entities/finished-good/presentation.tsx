/**
 * Finished Good Entity — presentation
 *
 * The React/UI half of the finished good entity: list columns, list filters,
 * and the unified detail/edit sections (including section-level components for
 * inventory and revision history).
 */

import type { EntityPresentation } from "@/types/entity";
import { createRevisionHistoryDisplay } from "@/components/domain/shared/revision-history-display";
import { FGInventorySection } from "@/components/domain/inventory/fg-inventory-section";
import type { FinishedGoodView } from "./core";

export const finishedGoodPresentation: EntityPresentation<FinishedGoodView> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "lot_number",
      header: "Lot Code",
    },
    {
      accessorKey: "brand_name",
      header: "Brand",
    },
    {
      accessorKey: "selling_format_name",
      header: "Format",
    },
    {
      accessorKey: "quantity",
      header: "Total",
    },
    {
      accessorKey: "available_quantity",
      header: "Available",
    },
    {
      accessorKey: "production_date",
      header: "Packaged",
    },
  ],

  listFilters: [
    {
      field: "brand_id",
      type: "select",
      label: "Brand",
      dynamicOptions: {
        table: "brands",
        valueField: "id",
        labelField: "name",
        orderBy: "name",
      },
    },
    {
      field: "selling_format_id",
      type: "select",
      label: "Format",
      dynamicOptions: {
        table: "selling_formats",
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
      title: "Product Information",
      fields: [
        {
          name: "lot_number",
          label: "Lot Code",
          type: "text",
          required: true,
          colSpan: 6,
        },
        {
          name: "quantity",
          label: "Quantity",
          type: "number",
          required: true,
          colSpan: 6,
        },
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
          name: "batch_id",
          label: "Source Batch",
          type: "relation",
          colSpan: 6,
          relation: { entity: "batch", displayField: "batch_code" },
        },
      ],
    },
    {
      id: "inventory",
      title: "Inventory",
      hideOnCreate: true,
      component: FGInventorySection,
    },
    {
      id: "dates",
      title: "Dates",
      fields: [
        {
          name: "production_date",
          label: "Production Date",
          type: "date",
          format: "date",
          colSpan: 4,
        },
        {
          name: "best_by_date",
          label: "Best By",
          type: "date",
          format: "date",
          colSpan: 4,
        },
        {
          name: "expiration_date",
          label: "Expiration",
          type: "date",
          format: "date",
          colSpan: 4,
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
          fullWidth: true,
          colSpan: 12,
        },
      ],
    },
    {
      id: "revision-history",
      title: "Revision History",
      hideOnCreate: true,
      component: createRevisionHistoryDisplay("finished_goods"),
      collapsible: true,
    },
  ],
};
