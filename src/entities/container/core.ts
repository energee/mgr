/**
 * Container Entity — server-safe core
 *
 * The pure-data half of the container entity: identity, the zod form schema,
 * relations, and AI metadata. No React imports — safe to import from server
 * route handlers and API routes.
 *
 * Containers represent physical vessels — cans, bottles, kegs. Parent of
 * selling_formats which define how containers are grouped for sale.
 */

import { z } from "zod";
import type { EntityCoreInput } from "@/types/entity";
import type { Database } from "@/types/supabase";

export type Container = Database["public"]["Tables"]["containers"]["Row"];

// =============================================================================
// Constants
// =============================================================================

export const CONTAINER_TYPE_OPTIONS = [
  { value: "package", label: "Package" },
  { value: "keg", label: "Keg" },
];

// =============================================================================
// Zod Schema
// =============================================================================

export const containerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.string().min(1, "Type is required"),
  volume_oz: z.coerce.number().positive("Volume must be positive").nullable().optional(),
  volume_bbl: z.coerce.number().positive("Volume must be positive").nullable().optional(),
  deposit_amount: z.coerce.number().min(0, "Deposit cannot be negative").default(0),
  is_active: z.boolean().default(true),
  position: z.coerce.number().int().min(0).default(0),
}).refine(
  (data) => data.type !== "package" || (data.volume_oz != null && data.volume_oz > 0),
  { message: "Package containers require volume in oz", path: ["volume_oz"] }
).refine(
  (data) => data.type !== "keg" || (data.volume_bbl != null && data.volume_bbl > 0),
  { message: "Keg containers require volume in BBL", path: ["volume_bbl"] }
);

export type ContainerFormValues = z.infer<typeof containerSchema>;

// =============================================================================
// Entity Core
// =============================================================================

export const containerCore: EntityCoreInput<Container> = {
  name: "container",
  table: "containers",
  displayName: "Container",
  domain: "inventory",
  basePath: "/settings/containers",

  // searchableFields: ["name"] is the default — omitted.

  detailHeader: {
    title: "name",
  },

  formSchema: containerSchema,

  relations: [
    {
      name: "selling_formats",
      entity: "selling_format",
      foreignKey: "container_id",
      type: "hasMany",
    },
  ],

  keyFields: ["name", "type", "volume_oz", "volume_bbl", "deposit_amount", "is_active"],
};
