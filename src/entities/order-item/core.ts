/**
 * Order Item Entity — server-safe core
 *
 * The pure-data half of the order item entity: identity, the zod form schema,
 * relations, and AI metadata. No React imports — safe to import from server
 * route handlers and API routes.
 *
 * Order line items represent products on a sales order. References brand,
 * selling format, and quantity with optional batch link.
 */

import { z } from "zod";
import type { EntityCoreInput } from "@/types/entity";
import type { Database } from "@/types/supabase";

export type OrderItem = Database["public"]["Tables"]["order_items"]["Row"];

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
// Entity Core
// =============================================================================

export const orderItemCore: EntityCoreInput<OrderItem> = {
  name: "order_item",
  table: "order_items",
  displayName: "Order Item",
  defaultSort: { column: "created_at", direction: "desc" },
  domain: "sales",
  basePath: null,

  // Explicit: order items have no name column, so searchable fields are limited.
  searchableFields: ["notes"],

  detailHeader: {
    title: "brand_id",
  },

  formSchema: orderItemSchema,

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

  keyFields: ["order_id", "brand_id", "style_id", "selling_format_id", "quantity", "unit_price", "keg_owner_id"],
};
