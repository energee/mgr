/**
 * Supplier Entity — server-safe core
 *
 * The pure-data half of the supplier entity: identity, the zod form schema,
 * relations, and AI metadata. No React imports — safe to import from server
 * route handlers and API routes.
 *
 * Suppliers provide ingredients and materials for brewing. Includes contact
 * info, payment terms, and lead time tracking.
 */

import { z } from "zod";
import type { EntityCore } from "@/types/entity";
import type { Database } from "@/types/supabase";

type Supplier = Database["public"]["Tables"]["suppliers"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const supplierSchema = z.object({
  name: z.string().min(1, "Supplier name is required"),
  contact_name: z.string().nullable().optional(),
  contact_email: z.string().email().nullable().optional().or(z.literal("")),
  contact_phone: z.string().nullable().optional(),
  payment_terms: z.string().nullable().optional(),
  default_lead_time_days: z.coerce.number().nullable().optional(),
  is_active: z.boolean().default(true),
  notes: z.string().nullable().optional(),
});

export type SupplierFormValues = z.infer<typeof supplierSchema>;

// =============================================================================
// Entity Core
// =============================================================================

export const supplierCore: EntityCore<Supplier> = {
  name: "supplier",
  table: "suppliers",
  displayName: "Supplier",
  displayNamePlural: "Suppliers",
  domain: "purchasing",

  defaultSort: { column: "name", direction: "asc" },
  searchableFields: ["name", "contact_name", "contact_email"],

  detailHeader: {
    title: "name",
    badge: "is_active",
  },

  formSchema: supplierSchema,

  relations: [
    {
      name: "purchase_orders",
      entity: "purchase_order",
      type: "hasMany",
      foreignKey: "supplier_id",
      showInDetail: true,
      detailTab: "Orders",
    },
    {
      name: "catalog_items",
      entity: "supplier_catalog",
      type: "hasMany",
      foreignKey: "supplier_id",
      showInDetail: true,
      detailTab: "Catalog Items",
      // The `component` (SupplierCatalogSection) is supplied by
      // presentation.tsx via `relationComponents` so this module stays
      // free of React imports.
    },
  ],

  keyFields: ["name", "is_active", "payment_terms", "default_lead_time_days"],
};
