/**
 * Purchase Order Line Item Entity Configuration
 *
 * PO line items reference catalog items (malt, hop, yeast, etc.)
 * with quantity, unit, and pricing information.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";

type POLineItem = Database["public"]["Tables"]["po_line_items"]["Row"];

// =============================================================================
// Constants
// =============================================================================

export const CATALOG_TYPES = [
  { value: "malt", label: "Malt" },
  { value: "hop", label: "Hop" },
  { value: "yeast", label: "Yeast" },
  { value: "adjunct", label: "Adjunct" },
  { value: "additive", label: "Additive" },
  { value: "packaging", label: "Packaging" },
  { value: "other", label: "Other" },
] as const;

/**
 * Maps catalog types to their database table names.
 * Note: "other" type uses free-text input (no catalog table).
 */
export const CATALOG_TABLES: Record<string, string> = {
  malt: "malts",
  hop: "hops",
  yeast: "yeasts",
  adjunct: "adjuncts",
  additive: "additives",
  packaging: "package_types",
};

/**
 * Returns the human-readable label for a catalog type.
 */
export function getCatalogTypeLabel(type: string): string {
  return CATALOG_TYPES.find((t) => t.value === type)?.label || type;
}

/**
 * Returns true if the catalog type uses free-text input instead of a dropdown.
 */
export function isFreeTextCatalogType(type: string): boolean {
  return type === "other";
}

// =============================================================================
// Zod Schema
// =============================================================================

export const poLineItemSchema = z.object({
  po_id: z.string().uuid("Purchase order is required"),
  catalog_type: z.string().min(1, "Catalog type is required"),
  // catalog_id can be UUID (for catalog items) or free-text (for "other" type)
  catalog_id: z.string().min(1, "Item is required"),
  quantity: z.coerce.number().positive("Quantity must be greater than zero"),
  unit: z.string().min(1, "Unit is required"),
  unit_price: z.coerce.number().nullable().optional(),
});

export type POLineItemFormValues = z.infer<typeof poLineItemSchema>;

// =============================================================================
// Entity Configuration
// =============================================================================

export const poLineItemEntity: EntityConfig<POLineItem> = {
  name: "po_line_item",
  table: "po_line_items",
  viewTable: "po_line_items_with_quantities",
  displayName: "PO Line Item",
  displayNamePlural: "PO Line Items",
  description: "Purchase order line items for ingredients and materials",
  domain: "purchasing",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "catalog_type",
      header: "Type",
      sortable: true,
    },
    {
      accessorKey: "catalog_id",
      header: "Item",
    },
    {
      accessorKey: "quantity",
      header: "Qty",
      sortable: true,
    },
    {
      accessorKey: "received_quantity",
      header: "Received",
      sortable: true,
    },
    {
      accessorKey: "outstanding_quantity",
      header: "Outstanding",
      sortable: true,
    },
    {
      accessorKey: "unit",
      header: "Unit",
    },
    {
      accessorKey: "unit_price",
      header: "Unit Price",
      format: "currency",
    },
  ],

  defaultSort: { column: "created_at", direction: "desc" },
  searchableFields: [],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "catalog_type",
  },

  detailSections: [
    {
      id: "overview",
      title: "Line Item Details",
      fields: [
        { field: "catalog_type", label: "Catalog Type" },
        { field: "catalog_id", label: "Item ID" },
        { field: "quantity", label: "Quantity" },
        { field: "unit", label: "Unit" },
        { field: "unit_price", label: "Unit Price", format: "currency" },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: poLineItemSchema,

  formFields: [
    {
      name: "po_id",
      label: "Purchase Order",
      type: "relation",
      relation: { entity: "purchase_order", displayField: "po_number" },
      required: true,
      colSpan: 12,
    },
    {
      name: "catalog_type",
      label: "Item Type",
      type: "select",
      options: CATALOG_TYPES.map((t) => ({ value: t.value, label: t.label })),
      required: true,
      colSpan: 4,
    },
    {
      name: "catalog_id",
      label: "Item",
      type: "text", // Would need dynamic lookup based on catalog_type
      placeholder: "Select item type first",
      required: true,
      colSpan: 8,
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
      type: "text",
      placeholder: "e.g., lb, oz, kg",
      required: true,
      colSpan: 4,
    },
    {
      name: "unit_price",
      label: "Unit Price",
      type: "number",
      placeholder: "0.00",
      colSpan: 4,
    },
  ],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "purchase_order",
      entity: "purchase_order",
      type: "belongsTo",
      foreignKey: "po_id",
      showInDetail: true,
    },
    {
      name: "receives",
      entity: "po_receive",
      type: "hasMany",
      foreignKey: "po_line_item_id",
      showInDetail: true,
      detailTab: "Receives",
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show line items for PO-2025-001",
    "List all malt orders this month",
    "Find hop purchases by price",
  ],

  keyFields: ["po_id", "catalog_type", "catalog_id", "quantity", "unit"],
};
