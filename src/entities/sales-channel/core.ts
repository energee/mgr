/**
 * Sales Channel Entity — server-safe core
 *
 * The pure-data half of the sales channel entity: identity, the zod form
 * schema, relations, and AI metadata. No React imports — safe to import
 * from server route handlers and API routes.
 *
 * Sales channels categorize customers for pricing purposes. Common channels:
 * Distributor, Retailer, Taproom, Export.
 */

import { z } from "zod";
import type { EntityCoreInput } from "@/types/entity";
import type { Database } from "@/types/supabase";

type SalesChannelBase = Database["public"]["Tables"]["sales_channels"]["Row"];
export type SalesChannel = SalesChannelBase & {
  change_request_cutoff_state?: string | null;
};

// =============================================================================
// Zod Schema
// =============================================================================

export const salesChannelSchema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required").max(20, "Code must be 20 characters or less"),
  description: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
  position: z.coerce.number().int().nullable().optional(),
  change_request_cutoff_state: z.string().default("confirmed"),
});

export type SalesChannelFormValues = z.infer<typeof salesChannelSchema>;

// =============================================================================
// Entity Core
// =============================================================================

export const salesChannelCore: EntityCoreInput<SalesChannel> = {
  name: "sales_channel",
  table: "sales_channels",
  displayName: "Sales Channel",
  defaultSort: { column: "name", direction: "asc" },
  description: "Sales channel categories for customer pricing",
  domain: "sales",

  searchableFields: ["name", "code", "description"],

  detailHeader: { title: "name" },

  formSchema: salesChannelSchema,

  relations: [
    {
      name: "pricing_tier_prices",
      entity: "pricing_tier_price",
      type: "hasMany",
      foreignKey: "sales_channel_id",
      showInDetail: true,
      detailTab: "Prices",
    },
    {
      name: "customers",
      entity: "customer",
      type: "hasMany",
      foreignKey: "sales_channel_id",
      showInDetail: true,
      detailTab: "Customers",
    },
  ],

  queryExamples: [
    "Show me all active sales channels",
    "What customers are in the distributor channel?",
    "List price tiers for retail channel",
  ],

  keyFields: ["name", "code", "is_active"],
};
