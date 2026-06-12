/**
 * Supplier Entity Configuration
 *
 * Suppliers provide ingredients and materials for brewing.
 * Includes contact info, payment terms, and lead time tracking, plus a
 * "Catalog Items" tab (custom relation component — supplier_catalog is
 * polymorphic) managing per-item price / MOQ / lead time / preferred flags
 * that drive supplier assignment in demand planning.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { Badge } from "@/components/ui/badge";
import { createQBOSyncDisplay } from "@/components/domain/shared/qbo-sync-section";
import { SupplierCatalogSection } from "@/components/domain/purchasing/supplier-catalog-section";

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
// Entity Configuration
// =============================================================================

export const supplierEntity: EntityConfig<Supplier> = {
  name: "supplier",
  table: "suppliers",
  displayName: "Supplier",
  displayNamePlural: "Suppliers",
  description: "Ingredient and material suppliers",
  domain: "purchasing",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "name",
      header: "Supplier",
      sortable: true,
    },
    {
      accessorKey: "contact_name",
      header: "Contact",
    },
    {
      accessorKey: "contact_email",
      header: "Email",
    },
    {
      accessorKey: "contact_phone",
      header: "Phone",
    },
    {
      accessorKey: "default_lead_time_days",
      header: "Lead Time",
      render: (value) => (value ? `${value} days` : "—"),
    },
    {
      accessorKey: "is_active",
      header: "Status",
      render: (value) => (
        <Badge variant={value ? "default" : "secondary"}>
          {value ? "Active" : "Inactive"}
        </Badge>
      ),
    },
  ],

  listFilters: [
    {
      field: "is_active",
      type: "boolean",
      label: "Active",
    },
  ],

  defaultSort: { column: "name", direction: "asc" },
  searchableFields: ["name", "contact_name", "contact_email"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "name",
    badge: "is_active",
  },

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Supplier Details",
      fields: [
        {
          name: "name",
          label: "Supplier Name",
          type: "text",
          placeholder: "e.g., Briess Malt & Ingredients",
          required: true,
          colSpan: 6,
        },
        {
          name: "is_active",
          label: "Active",
          type: "switch",
          defaultValue: true,
          description: "Inactive suppliers won't appear in purchase order creation",
          colSpan: 6,
        },
      ],
    },
    {
      id: "contact",
      title: "Contact Information",
      fields: [
        {
          name: "contact_name",
          label: "Contact Name",
          type: "text",
          placeholder: "e.g., John Smith",
          colSpan: 6,
        },
        {
          name: "contact_email",
          label: "Email",
          type: "text",
          placeholder: "orders@supplier.com",
          colSpan: 6,
        },
        {
          name: "contact_phone",
          label: "Phone",
          type: "text",
          placeholder: "(555) 123-4567",
          colSpan: 6,
        },
      ],
    },
    {
      id: "terms",
      title: "Terms & Logistics",
      fields: [
        {
          name: "payment_terms",
          label: "Payment Terms",
          type: "text",
          placeholder: "e.g., Net 30, COD, 2% 10 Net 30",
          colSpan: 6,
        },
        {
          name: "default_lead_time_days",
          label: "Default Lead Time (days)",
          type: "number",
          placeholder: "e.g., 7",
          description: "Typical days between order and delivery",
          colSpan: 6,
        },
      ],
    },
    {
      id: "qbo-sync",
      title: "QuickBooks",
      component: createQBOSyncDisplay("supplier"),
    },
    {
      id: "notes",
      title: "Notes",
      collapsible: true,
      fields: [
        {
          name: "notes",
          label: "Notes",
          type: "textarea",
          placeholder: "Additional information about this supplier...",
          fullWidth: true,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: supplierSchema,

  // Framework Duplicate action (EntityDetailUnified): no identity fields
  // beyond the framework baseline — name carries over for the user to tweak.
  excludeOnDuplicate: [],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "delete",
      label: "Delete Supplier",
      icon: "trash",
      type: "dropdown",
      variant: "destructive",
      deleteMode: "hard",
    },
  ],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
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
      // supplier_catalog is polymorphic (catalog_type + catalog_id), so the
      // tab uses a custom component instead of the generic RelationTable.
      name: "catalog_items",
      entity: "supplier_catalog",
      type: "hasMany",
      foreignKey: "supplier_id",
      showInDetail: true,
      detailTab: "Catalog Items",
      component: SupplierCatalogSection,
    },
  ],
};
