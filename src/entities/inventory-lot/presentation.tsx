/**
 * Inventory Lot Entity — presentation
 *
 * The React/UI half of the inventory lot entity: list columns, list filters,
 * and the unified detail/edit sections.
 */

import type { EntityPresentation } from "@/types/entity";
import { deleteAction } from "@/types/entity";
import { INVENTORY_UNIT_OPTIONS } from "@/domain/inventory-units";
import type { InventoryLot } from "./core";

export const inventoryLotPresentation: EntityPresentation<InventoryLot> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "lot_number",
      header: "Lot #",
      sortable: true,
    },
    {
      accessorKey: "item_name",
      header: "Item",
      sortable: true,
    },
    {
      accessorKey: "quantity",
      header: "Quantity",
      sortable: true,
    },
    {
      accessorKey: "remaining_quantity",
      header: "Remaining",
      sortable: true,
    },
    {
      accessorKey: "allocated_quantity",
      header: "Allocated",
      sortable: true,
    },
    {
      accessorKey: "unit",
      header: "Unit",
    },
    {
      accessorKey: "expiration_date",
      header: "Expires",
      sortable: true,
      format: "date",
    },
    {
      accessorKey: "unit_cost",
      header: "Unit Cost",
      sortable: true,
      format: "currency",
    },
    {
      accessorKey: "landed_cost",
      header: "Landed Cost",
      sortable: true,
      format: "currency",
    },
    {
      accessorKey: "received_date",
      header: "Received",
      sortable: true,
      format: "date",
    },
  ],

  listFilters: [
    {
      field: "inventory_item_id",
      type: "select",
      label: "Item",
      dynamicOptions: {
        table: "inventory_items",
        valueField: "id",
        labelField: "name",
        orderBy: "name",
      },
    },
  ],

  // ---------------------------------------------------------------------------
  // Unified Sections (for EntityDetailUnified)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Lot Information",
      fields: [
        {
          name: "inventory_item_id",
          label: "Inventory Item",
          type: "relation",
          relation: { entity: "inventory_item", displayField: "name" },
          required: true,
          colSpan: 6,
        },
        {
          name: "lot_number",
          label: "Lot Number",
          type: "text",
          placeholder: "e.g., LOT-2025-001 or supplier lot #",
          colSpan: 6,
        },
        {
          name: "location",
          label: "Storage Location",
          type: "text",
          placeholder: "e.g., Grain Room A",
          colSpan: 6,
        },
        {
          name: "po_receive_id",
          label: "PO Receive",
          type: "relation",
          relation: { entity: "po_receive", displayField: "id" },
          colSpan: 6,
        },
      ],
    },
    {
      id: "quantities",
      title: "Quantities",
      fields: [
        {
          name: "quantity",
          label: "Quantity",
          type: "number",
          required: true,
          colSpan: 4,
        },
        {
          name: "remaining_quantity",
          label: "Remaining",
          type: "number",
          editable: false,
          colSpan: 4,
        },
        {
          name: "allocated_quantity",
          label: "Allocated",
          type: "number",
          editable: false,
          colSpan: 4,
        },
        {
          name: "unit",
          label: "Unit",
          type: "select",
          required: true,
          options: INVENTORY_UNIT_OPTIONS,
          colSpan: 4,
        },
      ],
    },
    {
      id: "costs",
      title: "Costs",
      fields: [
        {
          name: "unit_cost",
          label: "Unit Cost",
          type: "number",
          format: "currency",
          placeholder: "0.00",
          colSpan: 4,
        },
        {
          name: "landed_cost",
          label: "Landed Cost",
          type: "number",
          format: "currency",
          placeholder: "0.00",
          description: "Total cost including shipping/handling",
          colSpan: 4,
        },
      ],
    },
    {
      id: "dates",
      title: "Dates",
      fields: [
        {
          name: "received_date",
          label: "Received Date",
          type: "date",
          format: "date",
          colSpan: 6,
        },
        {
          name: "expiration_date",
          label: "Expiration Date",
          type: "date",
          format: "date",
          colSpan: 6,
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
          placeholder: "Quality notes, storage requirements...",
          fullWidth: true,
          colSpan: 12,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [deleteAction("Inventory Lot")],

  // Duplicate reuses item/qty/costs; lot identity + receipt link stay unique.
  excludeOnDuplicate: ["lot_number", "po_receive_id", "received_date"],
};
