/**
 * Order Item Entity Configuration
 *
 * Order line items represent products on a sales order.
 * References brand, package type, and quantity with optional batch link.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";

type OrderItem = Database["public"]["Tables"]["order_items"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const orderItemSchema = z.object({
  order_id: z.string().uuid("Order is required"),
  brand_id: z.string().uuid().nullable().optional(),
  package_type_id: z.string().uuid().nullable().optional(),
  batch_id: z.string().uuid().nullable().optional(),
  quantity: z.coerce.number().int().positive("Quantity must be at least 1"),
  unit_price: z.coerce.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type OrderItemFormValues = z.infer<typeof orderItemSchema>;

// =============================================================================
// Entity Configuration
// =============================================================================

export const orderItemEntity: EntityConfig<OrderItem> = {
  name: "order_item",
  table: "order_items",
  displayName: "Order Item",
  displayNamePlural: "Order Items",
  description: "Line items on a sales order",
  domain: "sales",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "brand_id",
      header: "Brand",
      relation: {
        entity: "brand",
        displayField: "name",
      },
    },
    {
      accessorKey: "package_type_id",
      header: "Package",
      relation: {
        entity: "package_type",
        displayField: "name",
      },
    },
    {
      accessorKey: "quantity",
      header: "Qty",
      sortable: true,
    },
    {
      accessorKey: "unit_price",
      header: "Unit Price",
      format: "currency",
    },
    {
      accessorKey: "notes",
      header: "Notes",
    },
  ],

  defaultSort: { column: "created_at", direction: "desc" },
  searchableFields: ["notes"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "brand_id",
  },

  detailSections: [
    {
      id: "overview",
      title: "Item Details",
      fields: [
        { field: "brand_id", label: "Brand" },
        { field: "package_type_id", label: "Package Type" },
        { field: "quantity", label: "Quantity" },
        { field: "unit_price", label: "Unit Price", format: "currency" },
        { field: "batch_id", label: "Batch" },
        { field: "notes", label: "Notes" },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: orderItemSchema,

  formFields: [
    {
      name: "order_id",
      label: "Order",
      type: "relation",
      relation: { entity: "order", displayField: "order_number" },
      required: true,
      colSpan: 12,
    },
    {
      name: "brand_id",
      label: "Brand",
      type: "relation",
      relation: { entity: "brand", displayField: "name" },
      required: false,
      colSpan: 6,
    },
    {
      name: "package_type_id",
      label: "Package Type",
      type: "relation",
      relation: { entity: "package_type", displayField: "name" },
      required: false,
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
      name: "unit_price",
      label: "Unit Price",
      type: "number",
      placeholder: "0.00",
      colSpan: 4,
    },
    {
      name: "batch_id",
      label: "Batch (optional)",
      type: "relation",
      relation: { entity: "batch", displayField: "batch_number" },
      required: false,
      colSpan: 4,
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      colSpan: 12,
    },
  ],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "order",
      entity: "order",
      type: "belongsTo",
      foreignKey: "order_id",
      showInDetail: true,
    },
    {
      name: "batch",
      entity: "batch",
      type: "belongsTo",
      foreignKey: "batch_id",
      showInDetail: false,
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show items for order ORD-2025-001",
    "List all line items with unit price over $10",
    "Find items for IPA brand",
  ],

  keyFields: ["order_id", "brand_id", "package_type_id", "quantity", "unit_price"],
};
