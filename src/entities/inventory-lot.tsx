/**
 * Inventory Lot Entity Configuration
 *
 * Inventory lots track raw materials with lot numbers, expiration dates,
 * and FIFO costing. Quantities are derived from allocations.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { INVENTORY_UNIT_OPTIONS } from "@/domain/inventory-units";

/** Extended type including computed columns from the inventory_lots_with_quantities view */
type InventoryLotWithQuantities =
  Database["public"]["Views"]["inventory_lots_with_quantities"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const inventoryLotSchema = z.object({
  inventory_item_id: z.string().uuid("Inventory item is required"),
  po_receive_id: z.string().uuid().nullable().optional(),
  lot_number: z.string().nullable().optional(),
  quantity: z.coerce.number().positive("Quantity must be greater than zero"),
  unit: z.string().min(1, "Unit is required"),
  unit_cost: z.coerce.number().nullable().optional(),
  landed_cost: z.coerce.number().nullable().optional(),
  received_date: z.string().nullable().optional(),
  expiration_date: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type InventoryLotFormValues = z.infer<typeof inventoryLotSchema>;

// =============================================================================
// Entity Configuration
// =============================================================================

export const inventoryLotEntity: EntityConfig<InventoryLotWithQuantities> = {
  name: "inventory_lot",
  table: "inventory_lots",
  viewTable: "inventory_lots_with_quantities",
  displayName: "Inventory Lot",
  displayNamePlural: "Inventory Lots",
  description:
    "Lot-level inventory tracking for raw materials with FIFO costing",
  domain: "inventory",
  basePath: "/inventory/lots",

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

  defaultSort: { column: "received_date", direction: "desc" },
  searchableFields: ["lot_number", "location", "notes"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "lot_number",
  },

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
          // Legacy text column, now constrained to canonical bin names so
          // values stay reconcilable with the bins entity. Lots accepted
          // from POs additionally get a structured bin_inventory_items
          // placement row (see po-accept-inventory-dialog.tsx); pre-existing
          // free-text values remain readable but won't match an option.
          name: "location",
          label: "Storage Location",
          type: "select",
          dynamicOptions: {
            table: "bins",
            valueField: "name",
            labelField: "name",
            orderBy: "name",
            filter: { is_active: true },
          },
          placeholder: "Select a bin...",
          description: "Bins are managed at Inventory → Bins",
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
          // Shared with inventory items and PO line items (the old inline
          // list here was missing "case", so case-tracked items could never
          // have their lots edited back to the item's own unit).
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
  // Form
  // ---------------------------------------------------------------------------
  formSchema: inventoryLotSchema,

  // Framework Duplicate action (EntityDetailUnified): a duplicated lot is a
  // new physical lot — it gets its own lot number, is not tied to the
  // original's PO receipt, and is received fresh. remaining/allocated
  // quantities are editable:false and never carry over.
  excludeOnDuplicate: ["lot_number", "po_receive_id", "received_date"],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "inventory_item",
      entity: "inventory_item",
      type: "belongsTo",
      foreignKey: "inventory_item_id",
      showInDetail: true,
    },
    {
      name: "po_receive",
      entity: "po_receive",
      type: "belongsTo",
      foreignKey: "po_receive_id",
      showInDetail: true,
    },
  ],
};
