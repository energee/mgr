/**
 * Selling Format Entity — server-safe core
 *
 * The pure-data half of the selling format entity: identity, the zod form
 * schema, relations, and AI metadata. No React imports — safe to import from
 * server route handlers and API routes.
 *
 * Selling formats define how a container is grouped for sale — single, 4-pack,
 * case of 24, per keg. Each selling format belongs to one container.
 */

import { z } from "zod";
import type { EntityCoreInput } from "@/types/entity";
import type { Database } from "@/types/supabase";

export type SellingFormat = Database["public"]["Tables"]["selling_formats"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

/** Coerce empty/null/undefined to null, otherwise to Number — for optional integer fields. */
const optionalInt = z.preprocess(
  (v) => (v === "" || v == null ? null : Number(v)),
  z.number().int().positive("Must be positive").nullable().optional()
);

export const sellingFormatSchema = z.object({
  name: z.string().min(1, "Name is required"),
  container_id: z.string().uuid("Container is required"),
  unit_count: z.coerce.number().int().positive("Unit count must be positive").default(1),
  units_per_layer: optionalInt,
  default_layers: optionalInt,
  pallet_quantity: optionalInt,
  is_active: z.boolean().default(true),
  position: z.coerce.number().int().min(0).default(0),
});

export type SellingFormatFormValues = z.infer<typeof sellingFormatSchema>;

// =============================================================================
// Entity Core
// =============================================================================

export const sellingFormatCore: EntityCoreInput<SellingFormat> = {
  name: "selling_format",
  table: "selling_formats",
  displayName: "Selling Format",
  description: "How a container is grouped for sale — single, 4-pack, case, per keg.",
  domain: "inventory",
  basePath: "/settings/selling-formats",

  // searchableFields: ["name"] is the default — omitted.

  detailHeader: {
    title: "name",
  },

  formSchema: sellingFormatSchema,

  relations: [
    {
      name: "bill_of_materials",
      entity: "selling_format_material",
      type: "hasMany" as const,
      foreignKey: "selling_format_id",
      showInDetail: true,
      detailTab: "Bill of Materials",
      // The `component` (BOMRelation) is supplied by presentation.tsx via
      // `relationComponents` so this module stays free of React imports.
    },
  ],

  queryExamples: [
    "Show all selling formats",
    "What formats are available for 12oz cans?",
    "List active selling formats with unit counts",
  ],

  keyFields: ["name", "container_id", "unit_count", "is_active"],
};
