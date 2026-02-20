/**
 * Water Profile Zod Schema
 *
 * Validation for source water chemistry profiles (mineral content).
 */

import { z } from "zod";

export const waterProfileSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().nullable().optional(),
  calcium_ppm: z.coerce.number().min(0).nullable().optional(),
  magnesium_ppm: z.coerce.number().min(0).nullable().optional(),
  sodium_ppm: z.coerce.number().min(0).nullable().optional(),
  sulfate_ppm: z.coerce.number().min(0).nullable().optional(),
  chloride_ppm: z.coerce.number().min(0).nullable().optional(),
  bicarbonate_ppm: z.coerce.number().min(0).nullable().optional(),
  ph: z.coerce.number().min(0).max(14).nullable().optional(),
  is_active: z.boolean().default(true),
});

export type WaterProfileFormValues = z.infer<typeof waterProfileSchema>;
