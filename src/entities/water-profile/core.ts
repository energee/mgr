/**
 * Water Profile Entity — server-safe core
 *
 * The pure-data half of the water profile entity: identity, the zod form
 * schema, and AI metadata. No React imports — safe to import from server
 * route handlers and API routes.
 *
 * Source water chemistry profiles (e.g., "City Tap Water", "RO Water").
 * Stores mineral content in ppm; recipes link to a profile via
 * water_profile_id.
 */

import type { EntityCoreInput } from "@/types/entity";
import { waterProfileSchema } from "@/lib/schemas/water-profile";
import type { Database } from "@/types/supabase";

export type WaterProfile = Database["public"]["Tables"]["water_profiles"]["Row"];

export { waterProfileSchema };
export type { WaterProfileFormValues } from "@/lib/schemas/water-profile";

// =============================================================================
// Entity Core
// =============================================================================

export const waterProfileCore: EntityCoreInput<WaterProfile> = {
  name: "water_profile",
  table: "water_profiles",
  displayName: "Water Profile",
  defaultSort: { column: "name", direction: "asc" },
  domain: "system",
  basePath: "/settings/water-profiles",

  // "Water Profiles" plural and the name-sorted default come from
  // createEntityConfig(); search additionally covers the description.
  searchableFields: ["name", "description"],

  detailHeader: { title: "name" },

  formSchema: waterProfileSchema,

  keyFields: ["name", "is_active"],
};
