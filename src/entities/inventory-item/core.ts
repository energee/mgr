/**
 * Inventory Item Entity — server-safe core
 *
 * The pure-data half of the inventory item entity: identity, the zod form
 * schema, value display configuration, and AI metadata. No React imports —
 * safe to import from server route handlers and API routes.
 *
 * Inventory items are raw materials, packaging supplies, and other
 * consumables tracked in the brewery's inventory system.
 */

import { z } from "zod";
import type { EntityCoreInput, ValueDisplayConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";

export type InventoryItem = Database["public"]["Tables"]["inventory_items"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const inventoryItemSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.string().min(1, "Category is required"),
  sku: z.string().nullable().optional(),
  unit: z.string().min(1, "Unit is required"),
  reorder_point: z.coerce.number().nullable().optional(),
  reorder_qty: z.coerce.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
});

export type InventoryItemFormValues = z.infer<typeof inventoryItemSchema>;

// =============================================================================
// Value Display Configuration
// =============================================================================

export const categoryDisplayConfig: ValueDisplayConfig = {
  field: "category",
  display: {
    grain: { label: "Grain", color: "default" },
    hop: { label: "Hop", color: "success" },
    yeast: { label: "Yeast", color: "info" },
    adjunct: { label: "Adjunct", color: "warning" },
    chemical: { label: "Chemical", color: "info" },
    packaging: { label: "Packaging", color: "default" },
    equipment: { label: "Equipment", color: "default" },
    other: { label: "Other", color: "default" },
  },
};

// =============================================================================
// Entity Core
// =============================================================================

export const inventoryItemCore: EntityCoreInput<InventoryItem> = {
  name: "inventory_item",
  table: "inventory_items",
  displayName: "Inventory Item",
  description: "Raw materials, packaging, and supplies",
  domain: "inventory",
  basePath: "/inventory/items",

  // defaultSort omitted — defaults to { column: "name", direction: "asc" }
  searchableFields: ["name", "sku"],

  detailHeader: {
    title: "name",
    subtitle: "category",
  },

  formSchema: inventoryItemSchema,

  valueDisplay: [categoryDisplayConfig],

  queryExamples: [
    "Show me all hops in inventory",
    "What grain items are below reorder point?",
    "List active packaging supplies",
    "Find items from Yakima Valley Hops",
  ],

  keyFields: ["name", "category", "unit", "reorder_point", "is_active"],
};

