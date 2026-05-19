/**
 * Brand Entity — server-safe core
 *
 * The pure-data half of the brand entity: identity, the zod form schema,
 * relations, and AI metadata. No React imports — safe to import from server
 * route handlers and API routes.
 *
 * Brands represent the brewery's beer products/labels. Each brand has a
 * style, ABV, and optional Untappd integration.
 */

import { z } from "zod";
import type { EntityCoreInput } from "@/types/entity";
import type { Database } from "@/types/supabase";

export type Brand = Database["public"]["Tables"]["brands"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const brandSchema = z.object({
  name: z.string().min(1, "Name is required"),
  variant: z.string().nullable().optional(),
  style_id: z.string().uuid().nullable().optional(),
  abv: z.coerce.number().nullable().optional(),
  description: z.string().nullable().optional(),
  untappd_url: z.string().url().nullable().optional().or(z.literal("")),
});

export type BrandFormValues = z.infer<typeof brandSchema>;

// =============================================================================
// Entity Core
// =============================================================================

export const brandCore: EntityCoreInput<Brand> = {
  name: "brand",
  table: "brands",
  displayName: "Brand",
  defaultSort: { column: "name", direction: "asc" },
  description: "Beer brands and products",
  domain: "production",

  searchableFields: ["name", "variant", "description"],

  detailHeader: {
    title: "name",
    subtitle: "variant",
  },

  formSchema: brandSchema,

  relations: [
    {
      name: "style",
      entity: "beer_style",
      type: "belongsTo",
      foreignKey: "style_id",
    },
  ],

  queryExamples: [
    "List all brands",
    "What IPAs do we make?",
    "Show brands over 7% ABV",
    "What's the most popular brand on Untappd?",
  ],

  keyFields: ["name", "variant", "style_id", "abv"],
};
