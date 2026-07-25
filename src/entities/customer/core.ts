/**
 * Customer Entity — server-safe core
 *
 * The pure-data half of the customer entity: identity, the zod form schema,
 * value display, relations, and AI metadata. No React imports — safe to
 * import from server route handlers and API routes.
 *
 * Customers include distributors, retailers, taproom sales,
 * and direct-to-consumer accounts.
 */

import { z } from "zod";
import type { EntityCoreInput, ValueDisplayConfig } from "@/types/entity";
import { valuesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";

// Base type from customers table
type CustomerBase = Database["public"]["Tables"]["customers"]["Row"];

// Extended type for list/detail view (includes fields from customers_with_order_summary view)
// Note: View fields are added here since they may not be in generated types yet
export type Customer = CustomerBase & {
  // Fields from sales_channels and pricing_tiers joins
  sales_channel_name?: string | null;
  price_tier_name?: string | null;
  // Calculated order summary fields
  total_orders?: number | null;
  total_revenue?: number | null;
  pending_orders?: number | null;
  pending_revenue?: number | null;
  last_order_date?: string | null;
  // Keg balance summary fields (from customer_keg_balance_summary)
  total_kegs_out?: number | null;
  total_deposit_value?: number | null;
}

// =============================================================================
// Zod Schema
// =============================================================================

export const customerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  customer_type: z.string().min(1, "Customer type is required"),
  contact_name: z.string().nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal("")),
  phone: z.string().nullable().optional(),
  address: z.any().nullable().optional(), // JSONB
  sales_channel_id: z.string().uuid().nullable().optional(),
  price_tier_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
  is_tax_exempt: z.boolean().default(false),
  payment_terms_days: z.coerce.number().nullable().optional(),
});

export type CustomerFormValues = z.infer<typeof customerSchema>;

// =============================================================================
// Value Display Configuration
// =============================================================================

export const customerTypeDisplayConfig: ValueDisplayConfig = {
  field: "customer_type",
  display: {
    distributor: { label: "Distributor", color: "info" },
    retail: { label: "Retail", color: "success" },
    taproom: { label: "Taproom", color: "warning" },
    direct: { label: "Direct", color: "default" },
  },
};

// =============================================================================
// Entity Core
// =============================================================================

export const customerCore: EntityCoreInput<Customer> = {
  name: "customer",
  table: "customers",
  viewTable: "customers_with_order_summary",
  displayName: "Customer",
  domain: "sales",

  // defaultSort: { column: "name", direction: "asc" } — omitted (matches default)
  searchableFields: ["name", "contact_name", "email"],

  valueDisplay: [customerTypeDisplayConfig],

  detailHeader: {
    title: "name",
    subtitle: "customer_type",
  },

  formSchema: customerSchema,

  relations: [
    {
      name: "orders",
      entity: "order",
      type: "hasMany",
      foreignKey: "customer_id",
      showInDetail: true,
      detailTab: "Orders",
    },
  ],

  keyFields: ["name", "customer_type", "contact_name", "email", "is_active"],
};

// Derived options — exported for use in presentation and other modules
export const customerTypeOptions = valuesAsOptions(customerTypeDisplayConfig);
