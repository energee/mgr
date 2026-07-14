/** Runtime validation for Beer Orders preview mapping overrides. */

import { z } from "zod";

const tierSchema = z.number().int().min(1).max(7);

export const beerOrderMappingOverridesSchema = z.object({
  customers: z.record(
    z.string(),
    z.object({
      customerId: z.uuid().optional(),
      createName: z.string().trim().min(1).max(200).optional(),
    }).refine((value) => Boolean(value.customerId) !== Boolean(value.createName), {
      message: "Choose either an existing customer or a new distributor name",
    }),
  ).optional(),
  brands: z.record(
    z.string(),
    z.object({
      brandId: z.uuid(),
      tier: tierSchema.optional(),
    }),
  ).optional(),
});

export const beerOrderApplySchema = z.object({ runId: z.uuid() });
