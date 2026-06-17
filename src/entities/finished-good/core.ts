/**
 * Finished Good Entity — server-safe core
 *
 * The pure-data half of the finished good entity: identity, the zod form
 * schema, relations, and AI metadata. No React imports — safe to import from
 * server route handlers and API routes.
 *
 * Finished goods represent packaged products ready for sale. They are created
 * through packaging sessions (internal) or manually (external/contract). Each
 * finished good references a selling_format (unified container packaging).
 *
 * Internal FGs: created automatically when a packaging session completes.
 * External FGs: created manually with notes documenting the source.
 */

import { z } from "zod";
import type { EntityCoreInput } from "@/types/entity";
import type { Database } from "@/types/supabase";

// Use the view type for availability calculations
export type FinishedGoodView = Database["public"]["Views"]["finished_goods_with_availability"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const finishedGoodSchema = z.object({
  lot_number: z.string().min(1, "Lot number is required"),
  brand_id: z.string().uuid(),
  selling_format_id: z.string().uuid().nullable().optional(),
  batch_id: z.string().uuid().nullable().optional(),
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),
  production_date: z.string().nullable().optional(),
  best_by_date: z.string().nullable().optional(),
  expiration_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
}).refine(
  (data) => data.batch_id || (data.notes && data.notes.trim().length > 0),
  {
    message: "Notes are required for external finished goods (no source batch)",
    path: ["notes"],
  }
);

export type FinishedGoodFormValues = z.infer<typeof finishedGoodSchema>;

// =============================================================================
// Entity Core
// =============================================================================

export const finishedGoodCore: EntityCoreInput<FinishedGoodView> = {
  name: "finished_good",
  table: "finished_goods",
  viewTable: "finished_goods_with_availability",
  displayName: "Finished Good",
  description: "Packaged products ready for sale",
  domain: "inventory",

  // Explicit: sorted by most-recent production date first.
  defaultSort: { column: "production_date", direction: "desc" },
  searchableFields: ["lot_number", "brand_name", "selling_format_name", "notes"],

  detailHeader: {
    title: "lot_number",
    subtitle: "brand_name" as keyof FinishedGoodView & string,
  },

  formSchema: finishedGoodSchema,

  relations: [
    {
      name: "batch",
      entity: "batch",
      type: "belongsTo",
      foreignKey: "batch_id",
    },
    {
      name: "allocations",
      entity: "allocation",
      type: "hasMany",
      foreignKey: "source_id",
      showInDetail: true,
      detailTab: "Allocations",
    },
  ],

  queryExamples: [
    "Show all finished goods for brand X",
    "What FG has available inventory?",
    "List finished goods expiring this month",
    "Show allocation history for lot Y",
  ],

  keyFields: ["lot_number", "brand_id", "selling_format_id", "quantity", "available_quantity"],
};
