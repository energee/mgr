/**
 * Inventory Lot Entity Configuration
 *
 * Inventory lots track raw materials with lot numbers, expiration dates,
 * and FIFO costing. Quantities are derived from allocations.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";

type InventoryLot = Database["public"]["Tables"]["inventory_lots"]["Row"];

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

export const inventoryLotEntity: EntityConfig<InventoryLot> = {
  name: "inventory_lot",
  table: "inventory_lots",
  // viewTable: "inventory_lots_with_quantities",  // TODO: create this view for calculated quantities
  displayName: "Inventory Lot",
  displayNamePlural: "Inventory Lots",
  description:
    "Lot-level inventory tracking for raw materials with FIFO costing",
  domain: "inventory",

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
      accessorKey: "inventory_item_id",
      header: "Item",
      relation: {
        entity: "inventory_item",
        displayField: "name",
      },
    },
    {
      accessorKey: "quantity",
      header: "Quantity",
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

  detailSections: [
    {
      id: "overview",
      title: "Lot Information",
      fields: [
        { field: "lot_number", label: "Lot Number" },
        { field: "inventory_item_id", label: "Inventory Item" },
        { field: "location", label: "Storage Location" },
      ],
    },
    {
      id: "quantities",
      title: "Quantities",
      fields: [
        { field: "quantity", label: "Quantity" },
        { field: "unit", label: "Unit" },
      ],
    },
    {
      id: "costs",
      title: "Costs",
      fields: [
        { field: "unit_cost", label: "Unit Cost", format: "currency" },
        { field: "landed_cost", label: "Landed Cost", format: "currency" },
      ],
    },
    {
      id: "dates",
      title: "Dates",
      fields: [
        { field: "received_date", label: "Received Date", format: "date" },
        { field: "expiration_date", label: "Expiration Date", format: "date" },
      ],
    },
    {
      id: "notes",
      title: "Notes",
      fields: [{ field: "notes", label: "Notes", fullWidth: true }],
      collapsible: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: inventoryLotSchema,

  formFields: [
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
      name: "quantity",
      label: "Quantity",
      type: "number",
      required: true,
      colSpan: 4,
    },
    {
      name: "unit",
      label: "Unit",
      type: "select",
      required: true,
      options: [
        { value: "lb", label: "Pounds (lb)" },
        { value: "oz", label: "Ounces (oz)" },
        { value: "kg", label: "Kilograms (kg)" },
        { value: "g", label: "Grams (g)" },
        { value: "each", label: "Each" },
        { value: "gal", label: "Gallons" },
      ],
      colSpan: 4,
    },
    {
      name: "location",
      label: "Storage Location",
      type: "text",
      placeholder: "e.g., Grain Room A",
      colSpan: 4,
    },
    {
      name: "unit_cost",
      label: "Unit Cost",
      type: "number",
      placeholder: "0.00",
      colSpan: 4,
    },
    {
      name: "landed_cost",
      label: "Landed Cost",
      type: "number",
      placeholder: "0.00",
      description: "Total cost including shipping/handling",
      colSpan: 4,
    },
    {
      name: "po_receive_id",
      label: "PO Receive",
      type: "relation",
      relation: { entity: "po_receive", displayField: "id" },
      colSpan: 4,
    },
    {
      name: "received_date",
      label: "Received Date",
      type: "date",
      colSpan: 6,
    },
    {
      name: "expiration_date",
      label: "Expiration Date",
      type: "date",
      colSpan: 6,
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      placeholder: "Quality notes, storage requirements...",
      colSpan: 12,
    },
  ],

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

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show lots expiring this month",
    "Get available lots for Cascade hops (FIFO order)",
    "Find lots with remaining quantity",
    "Calculate COGS for batch using FIFO",
  ],

  keyFields: [
    "lot_number",
    "inventory_item_id",
    "quantity",
    "expiration_date",
  ],
};
