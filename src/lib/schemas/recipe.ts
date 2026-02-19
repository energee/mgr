/**
 * Recipe Zod Schema (server-safe)
 *
 * Extracted from src/entities/recipe.tsx so API routes can import
 * without pulling in client-side component dependencies.
 */

import { z } from "zod";

export const recipeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  brand_id: z.string().uuid().nullable().optional(),
  style_id: z.string().uuid().nullable().optional(),
  yeast_id: z.string().uuid().nullable().optional(),
  water_profile_id: z.string().uuid().nullable().optional(),
  pricing_tier_id: z.string().uuid().nullable().optional(),
  description: z.string().nullable().optional(),
  // Volumes
  volume_bbl: z.coerce.number().nullable().optional(),
  batch_size_bbl: z.coerce.number().nullable().optional(),
  preboil_volume_bbl: z.coerce.number().nullable().optional(),
  target_ko_volume_bbl: z.coerce.number().nullable().optional(),
  mash_water_volume_gal: z.coerce.number().nullable().optional(),
  sparge_water_volume_gal: z.coerce.number().nullable().optional(),
  // Times
  boil_time_min: z.coerce.number().int().nullable().optional(),
  fermentation_days: z.coerce.number().int().nullable().optional(),
  conditioning_days: z.coerce.number().int().nullable().optional(),
  // Whirlpool
  whirlpool_time_min: z.coerce.number().int().nullable().optional(),
  whirlpool_temp_f: z.coerce.number().int().nullable().optional(),
  whirlpool_rest_min: z.coerce.number().int().nullable().optional(),
  // Knock-Out
  target_ko_temp_f: z.coerce.number().nullable().optional(),
  // Mash
  mash_temp_f: z.coerce.number().int().nullable().optional(),
  target_mash_ph: z.coerce.number().nullable().optional(),
  mash_efficiency: z.coerce.number().nullable().optional(),
  // Yeast
  target_attenuation: z.coerce.number().nullable().optional(),
  target_pitching_rate: z.coerce.number().nullable().optional(),
  // Notes
  brew_day_notes: z.string().nullable().optional(),
  tasting_notes: z.string().nullable().optional(),
  development_notes: z.string().nullable().optional(),
  // Schedules (JSONB arrays stored directly on recipe row)
  mash_schedule: z.array(z.object({
    id: z.string().optional(),
    step_type: z.enum(["infusion", "decoction", "direct_heat", "rest"]),
    name: z.string(),
    temp_f: z.number(),
    duration_min: z.number(),
    notes: z.string().optional(),
    position: z.number(),
  })).nullable().optional(),
  fermentation_schedule: z.array(z.object({
    id: z.string().optional(),
    stage: z.enum(["primary", "secondary", "diacetyl_rest", "cold_crash", "conditioning", "lagering", "custom"]),
    name: z.string(),
    temp_f: z.number(),
    duration_days: z.number(),
    notes: z.string().optional(),
    position: z.number(),
  })).nullable().optional(),
  // Target Water Profile (for salt addition calculations)
  target_water_profile_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().default(true),
  // Status
  status: z.enum(["draft", "spec", "complete"]).default("complete"),
});

export type RecipeFormValues = z.infer<typeof recipeSchema>;
