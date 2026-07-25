/**
 * Inventory Lot Entity — server-safe core
 *
 * The pure-data half of the inventory lot entity: identity, the zod form
 * schema, relations, and AI metadata. No React imports — safe to import from
 * server route handlers and API routes.
 *
 * Inventory lots track raw materials with lot numbers, expiration dates,
 * and FIFO costing. Quantities are derived from allocations.
 */

import { z } from "zod";
import type { EntityCoreInput } from "@/types/entity";
import type { Database } from "@/types/supabase";

/** Extended type including computed columns from the inventory_lots_with_quantities view */
export type InventoryLot =
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
// Entity Core
// =============================================================================

export const inventoryLotCore: EntityCoreInput<InventoryLot> = {
  name: "inventory_lot",
  table: "inventory_lots",
  viewTable: "inventory_lots_with_quantities",
  displayName: "Inventory Lot",
  domain: "inventory",
  basePath: "/inventory/lots",

  defaultSort: { column: "received_date", direction: "desc" },
  searchableFields: ["lot_number", "location", "notes"],

  detailHeader: {
    title: "lot_number",
  },

  formSchema: inventoryLotSchema,

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

  keyFields: [
    "lot_number",
    "inventory_item_id",
    "quantity",
    "expiration_date",
  ],
};
