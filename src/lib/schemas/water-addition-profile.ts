/**
 * Water Addition Profile Zod Schema
 *
 * Validation for named water salt/acid addition profiles.
 * Profiles group reusable sets of water chemistry additions
 * that can be linked to recipes. Includes optional target ion
 * concentrations for auto-calculating salt additions.
 */

import { z } from "zod";

export const waterAdditionProfileSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
  water_profile_id: z.string().uuid().nullable().optional(),
  target_calcium_ppm: z.coerce.number().min(0).nullable().optional(),
  target_magnesium_ppm: z.coerce.number().min(0).nullable().optional(),
  target_sodium_ppm: z.coerce.number().min(0).nullable().optional(),
  target_sulfate_ppm: z.coerce.number().min(0).nullable().optional(),
  target_chloride_ppm: z.coerce.number().min(0).nullable().optional(),
  target_bicarbonate_ppm: z.coerce.number().min(0).nullable().optional(),
  target_ph: z.coerce.number().min(0).max(14).nullable().optional(),
});

export type WaterAdditionProfileFormValues = z.infer<typeof waterAdditionProfileSchema>;
