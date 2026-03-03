/**
 * Order Item Entity Configuration
 *
 * Order line items represent products on a sales order.
 * References brand, selling format, and quantity with optional batch link.
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
  selling_format_id: z.string().uuid().nullable().optional(),
  batch_id: z.string().uuid().nullable().optional(),
  keg_owner_id: z.string().uuid().nullable().optional(),
  style_id: z.string().uuid().nullable().optional(),
  tbd_notes: z.string().nullable().optional(),
  quantity: z.coerce.number().int().positive("Quantity must be at least 1"),
  unit_price: z.coerce.number().nullable().optional(),
  notes: z.string().nullable().optional(),
}).refine(
  (data) => data.brand_id || data.style_id,
  {
    message: "Either Brand or Style (for TBD) is required",
    path: ["brand_id"],
  }
);

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
      accessorKey: "style_id",
      header: "Style (TBD)",
      relation: {
        entity: "beer_style",
        displayField: "name",
      },
      render: (value, row) => {
        if (row.brand_id) return null; // Not TBD
        return value ? (
          <span className="text-muted-foreground italic">TBD: {String(value)}</span>
        ) : null;
      },
    },
    {
      accessorKey: "selling_format_id",
      header: "Format",
      relation: {
        entity: "selling_format",
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
        { field: "style_id", label: "Style (TBD)" },
        { field: "tbd_notes", label: "TBD Notes" },
        { field: "selling_format_id", label: "Selling Format" },
        { field: "quantity", label: "Quantity" },
        { field: "unit_price", label: "Unit Price", format: "currency" },
        { field: "batch_id", label: "Batch" },
        { field: "keg_owner_id", label: "Keg Owner" },
        { field: "notes", label: "Notes" },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Item Details",
      fields: [
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
          colSpan: 6,
        },
        {
          name: "style_id",
          label: "Style (for TBD)",
          type: "select",
          colSpan: 6,
          description: "Use when product is TBD - select the style category",
          dynamicOptions: {
            table: "beer_styles",
            valueField: "id",
            labelField: "name",
            orderBy: "category,name",
          },
        },
        {
          name: "tbd_notes",
          label: "TBD Notes",
          type: "textarea",
          colSpan: 12,
          placeholder: "Contract brew details, target specs, customer requirements...",
          description: "Details about the TBD product for planning purposes",
        },
        {
          name: "selling_format_id",
          label: "Selling Format",
          type: "relation",
          relation: { entity: "selling_format", displayField: "name" },
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
          format: "currency",
          placeholder: "0.00",
          colSpan: 4,
        },
        {
          name: "batch_id",
          label: "Batch (optional)",
          type: "relation",
          relation: { entity: "batch", displayField: "batch_number" },
          colSpan: 4,
        },
        {
          name: "keg_owner_id",
          label: "Keg Owner (optional)",
          type: "relation",
          relation: { entity: "keg_owner", displayField: "name" },
          description: "Fleet owner for keg orders (picker uses this to select kegs)",
          colSpan: 6,
        },
        {
          name: "notes",
          label: "Notes",
          type: "textarea",
          colSpan: 12,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: orderItemSchema,

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

  keyFields: ["order_id", "brand_id", "style_id", "selling_format_id", "quantity", "unit_price", "keg_owner_id"],
};
