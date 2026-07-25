/**
 * Brand Entity — server-safe core
 *
 * The pure-data half of the brand entity: identity, the zod form schema,
 * relations, and AI metadata. No React imports — safe to import from server
 * route handlers and API routes.
 *
 * Brands represent the brewery's beer products/labels. Each brand has a
 * style, ABV, optional Untappd integration, and an is_active lifecycle flag
 * (00244): inactive = discontinued, which is the ONLY path that removes a
 * brand's objects from the Square catalog (the sync's stale-cleanup keep set
 * is the active-brand set — audit IN-9).
 */

import { z } from "zod";
import type { EntityCoreInput } from "@/types/entity";
import type { Database } from "@/types/supabase";

type BrandBase = Database["public"]["Tables"]["brands"]["Row"];
// is_active (00244) is hand-extended pending a types regen once the migration
// is applied live (same idiom as sales-channel's change_request_cutoff_state).
// Optional because pre-00244 rows lack the column; absent = active (the column
// defaults true).
export type Brand = BrandBase & { is_active?: boolean };

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
  // Drives the Square catalog keep set (00244, audit IN-9): switching a brand
  // inactive deletes its mapped Square objects on the next catalog sync.
  is_active: z.boolean().default(true),
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

  // Server-safe mirror of the FK relation column in presentation.listColumns
  // (style_id → beer_style.name), so the server-prefetched brands list resolves
  // `__rel_style_id` display values identically to the client (sitewide loading
  // pattern). Keep in sync with the `style_id` list column in presentation.tsx.
  listRelations: [
    { accessorKey: "style_id", relation: { entity: "beer_style", displayField: "name" } },
  ],

  domain: "production",
  basePath: "/settings/brands",

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

  // NOTE: add "is_active" here once 00244 is applied live and the Supabase
  // types are regenerated — entity-map-sync.test.ts pins keyFields to columns
  // present in the GENERATED types, which don't carry the column yet.
  keyFields: ["name", "variant", "style_id", "abv"],
};
