/**
 * Water Addition Profile Zod Schema
 *
 * Validation for named water salt/acid addition profiles.
 * Profiles group reusable sets of water chemistry additions
 * that can be linked to recipes.
 */

import { z } from "zod";

export const waterAdditionProfileSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
});

export type WaterAdditionProfileFormValues = z.infer<typeof waterAdditionProfileSchema>;
