/**
 * Session Line Item Entity — server-safe core
 *
 * The pure-data half of the session line item entity: identity, the zod form
 * schema, relations, and AI metadata. No React imports — safe to import from
 * server route handlers and API routes.
 *
 * Line items within a packaging session. Each line item represents a product
 * (brand + selling format) being packaged from a single source batch.
 * Used as a relation from packaging-session entity.
 */

import { z } from "zod";
import type { EntityCoreInput } from "@/types/entity";
import type { Database } from "@/types/supabase";

// =============================================================================
// Types
// =============================================================================

export type SessionLineItem = Database["public"]["Tables"]["session_line_items"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const sessionLineItemSchema = z.object({
  session_id: z.string().uuid(),
  brand_id: z.string().uuid({ message: "Brand is required" }),
  selling_format_id: z.string().uuid().nullable().optional(),
  keg_owner_id: z.string().uuid().nullable().optional(),
  batch_id: z.string().uuid().nullable().optional(),
  planned_quantity: z.coerce.number().int().nullable().optional(),
  actual_quantity: z.coerce.number().int().nullable().optional(),
});

export type SessionLineItemFormValues = z.infer<typeof sessionLineItemSchema>;

// =============================================================================
// Entity Core
// =============================================================================

export const sessionLineItemCore: EntityCoreInput<SessionLineItem> = {
  name: "session_line_item",
  table: "session_line_items",
  displayName: "Line Item",
  defaultSort: { column: "created_at", direction: "desc" },
  description: "Products packaged in a session",
  domain: "production",
  // Inline-only: line items are managed on the packaging session detail page.
  basePath: null,

  // Explicit: no searchable text fields on this entity.
  searchableFields: [],

  detailHeader: {
    title: "brand_id",
  },

  formSchema: sessionLineItemSchema,

  relations: [
    {
      name: "session",
      entity: "packaging_session",
      type: "belongsTo",
      foreignKey: "session_id",
    },
    {
      name: "selling_format",
      entity: "selling_format",
      type: "belongsTo",
      foreignKey: "selling_format_id",
    },
  ],

  queryExamples: [
    "Show line items for session X",
    "What was packaged in the last session?",
    "Total units packaged by brand",
  ],

  keyFields: ["brand_id", "batch_id", "selling_format_id", "planned_quantity", "actual_quantity"],
};
