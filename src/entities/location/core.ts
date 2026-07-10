/**
 * Location Entity — server-safe core
 *
 * The pure-data half of the location entity: identity, the zod form schema,
 * value-display configuration, and AI metadata. No React imports — safe to
 * import from server route handlers and API routes.
 *
 * Locations represent physical facilities like breweries, warehouses,
 * taprooms, etc. Vessels, bins, and inventory are assigned to locations for
 * multi-site operations.
 */

import { z } from "zod";
import type { EntityCore, ValueDisplayConfig } from "@/types/entity";
import { valuesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";

// Square POS config lives on the BIN since 00222 (bins.square_location_id /
// pos_sales_channel_id); that migration dropped the locations_with_pos view and
// locations' square_location_id/pos_bin_id columns. This entity reads the plain
// table — there is no computed view, hence no viewTable below.
export type Location = Database["public"]["Tables"]["locations"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const locationSchema = z.object({
  name: z.string().min(1, "Name is required"),
  location_type: z.string().min(1, "Location type is required"),
  is_primary: z.boolean().default(false),
  is_active: z.boolean().default(true),
});

export type LocationFormValues = z.infer<typeof locationSchema>;

// =============================================================================
// Value Display Configuration
// =============================================================================

export const locationTypeDisplayConfig: ValueDisplayConfig = {
  field: "location_type",
  display: {
    brewery: { label: "Brewery" },
    warehouse: { label: "Warehouse" },
    taproom: { label: "Taproom" },
    cold_storage: { label: "Cold Storage" },
    dry_storage: { label: "Dry Storage" },
    production: { label: "Production" },
    offsite: { label: "Offsite" },
  },
};

// Export for backwards compatibility (some components may reference this)
export const LOCATION_TYPES = valuesAsOptions(locationTypeDisplayConfig);

// =============================================================================
// Entity Core
// =============================================================================

export const locationCore: EntityCore<Location> = {
  name: "location",
  table: "locations",
  displayName: "Location",
  displayNamePlural: "Locations",
  description: "Physical facilities for production, storage, and sales",
  domain: "system",
  basePath: "/settings/locations",

  defaultSort: { column: "name", direction: "asc" },
  searchableFields: ["name"],

  detailHeader: {
    title: "name",
    subtitle: "location_type",
  },

  formSchema: locationSchema,

  valueDisplay: [locationTypeDisplayConfig],

  queryExamples: [
    "List all locations",
    "Which location is the primary?",
    "Show all warehouses",
  ],

  keyFields: ["name", "location_type", "is_primary", "is_active"],
};
