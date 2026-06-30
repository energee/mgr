/**
 * Beer Style Entity — server-safe core
 *
 * The pure-data half of the beer style entity: identity, the zod form
 * schema, and AI metadata. No React imports — safe to import from server
 * route handlers and API routes.
 *
 * Beer styles define BJCP style guidelines and custom brewery styles. Each
 * style has target ranges for OG, FG, ABV, IBU, and SRM. BJCP styles are
 * seeded from official guidelines; custom styles can be added.
 */

import { z } from "zod";
import type { EntityCoreInput } from "@/types/entity";
import type { Database } from "@/types/supabase";

export type BeerStyle = Database["public"]["Tables"]["beer_styles"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const beerStyleSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.string().min(1, "Category is required"),
  description: z.string().nullable().optional(),
  og_min: z.coerce.number().nullable().optional(),
  og_max: z.coerce.number().nullable().optional(),
  fg_min: z.coerce.number().nullable().optional(),
  fg_max: z.coerce.number().nullable().optional(),
  abv_min: z.coerce.number().nullable().optional(),
  abv_max: z.coerce.number().nullable().optional(),
  ibu_min: z.coerce.number().nullable().optional(),
  ibu_max: z.coerce.number().nullable().optional(),
  srm_min: z.coerce.number().nullable().optional(),
  srm_max: z.coerce.number().nullable().optional(),
  is_active: z.boolean().default(true),
});

export type BeerStyleFormValues = z.infer<typeof beerStyleSchema>;

// =============================================================================
// Entity Core
// =============================================================================

export const beerStyleCore: EntityCoreInput<BeerStyle> = {
  name: "beer_style",
  table: "beer_styles",
  displayName: "Beer Style",
  description: "BJCP style guidelines and custom brewery styles",
  domain: "production",
  basePath: "/settings/beer-styles",

  // Explicit: the list groups styles by category, not by name.
  defaultSort: { column: "category", direction: "asc" },
  searchableFields: ["name", "category", "description"],

  detailHeader: {
    title: "name",
    subtitle: "category",
  },

  formSchema: beerStyleSchema,

  queryExamples: [
    "List all IPA styles",
    "What are the vital stats for American Pale Ale?",
    "Show BJCP lager styles",
    "What styles have ABV over 8%?",
  ],

  keyFields: ["name", "category", "abv_min", "abv_max", "ibu_min", "ibu_max"],
};
