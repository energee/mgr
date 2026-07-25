/**
 * Yeast Strain Entity — server-safe core
 *
 * The pure-data half of the yeast strain entity: identity, the zod form
 * schema, value display configs, and AI metadata. No React imports — safe to
 * import from server route handlers and API routes.
 *
 * Yeast strains catalog with fermentation characteristics. Includes attenuation
 * ranges, temperature preferences, flocculation, and more.
 */

import { z } from "zod";
import type { EntityCoreInput, ValueDisplayConfig } from "@/types/entity";
import { valuesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";

export type Yeast = Database["public"]["Tables"]["yeasts"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const yeastStrainSchema = z.object({
  name: z.string().min(1, "Name is required"),
  manufacturer: z.string().nullable().optional(),
  product_code: z.string().nullable().optional(),
  type: z.enum(["ale", "lager", "wild", "hybrid"]).default("ale"),
  form: z.enum(["dry", "liquid"]).default("liquid"),
  attenuation_min: z.coerce.number().min(0).max(100).nullable().optional(),
  attenuation_max: z.coerce.number().min(0).max(100).nullable().optional(),
  attenuation_typical: z.coerce.number().min(0).max(100).nullable().optional(),
  temp_min_f: z.coerce.number().int().nullable().optional(),
  temp_max_f: z.coerce.number().int().nullable().optional(),
  temp_ideal_f: z.coerce.number().int().nullable().optional(),
  flocculation: z.enum(["low", "medium", "high", "very_high"]).nullable().optional(),
  alcohol_tolerance: z.coerce.number().min(0).max(25).nullable().optional(),
  pitching_rate: z.coerce.number().min(0).max(5).default(0.75).nullable().optional(),
  description: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
});

export type YeastStrainFormValues = z.infer<typeof yeastStrainSchema>;

// =============================================================================
// Value Display Configurations
// =============================================================================

export const typeDisplayConfig: ValueDisplayConfig = {
  field: "type",
  display: {
    ale: { label: "Ale" },
    lager: { label: "Lager" },
    wild: { label: "Wild/Brett" },
    hybrid: { label: "Hybrid" },
  },
};

export const formDisplayConfig: ValueDisplayConfig = {
  field: "form",
  display: {
    liquid: { label: "Liquid" },
    dry: { label: "Dry" },
  },
};

export const flocculationDisplayConfig: ValueDisplayConfig = {
  field: "flocculation",
  display: {
    low: { label: "Low" },
    medium: { label: "Medium" },
    high: { label: "High" },
    very_high: { label: "Very High" },
  },
};

// =============================================================================
// Entity Core
// =============================================================================

export const yeastStrainCore: EntityCoreInput<Yeast> = {
  name: "yeast_strain",
  table: "yeasts",
  displayName: "Yeast Strain",
  defaultSort: { column: "name", direction: "asc" },
  domain: "production",
  basePath: "/settings/yeasts",

  searchableFields: ["name", "manufacturer", "product_code", "description"],

  detailHeader: {
    title: "name",
    subtitle: "manufacturer",
  },

  formSchema: yeastStrainSchema,

  valueDisplay: [typeDisplayConfig, formDisplayConfig, flocculationDisplayConfig],

  keyFields: ["name", "manufacturer", "type", "form", "attenuation_typical", "is_active"],
};

// Convenience option arrays derived from display configs (used in presentation)
export const typeOptions = valuesAsOptions(typeDisplayConfig);
export const formOptions = valuesAsOptions(formDisplayConfig);
export const flocculationOptions = valuesAsOptions(flocculationDisplayConfig);
