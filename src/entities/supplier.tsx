/**
 * Supplier Entity Configuration
 *
 * Manages suppliers for raw materials and other brewery inputs.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";

type Supplier = Database["public"]["Tables"]["suppliers"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const supplierSchema = z.object({
  name: z.string().min(1, "Name is required"),
  contact_name: z.string().nullable().optional(),
  contact_email: z.string().email("Invalid email").nullable().optional(),
  contact_phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  payment_terms: z.string().nullable().optional(),
  default_lead_time_days: z.coerce.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
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
  description: "Suppliers for raw materials and other brewery inputs",
  domain: "purchasing",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "name",
      header: "Name",
      sortable: true,
    },
    {
      accessorKey: "contact_name",
      header: "Contact",
      sortable: true,
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
      sortable: true,
      render: (value) => (value ? `${value} days` : "—"),
    },
    {
      accessorKey: "is_active",
      header: "Active",
      sortable: true,
      render: (value) => (value ? "Yes" : "No"),
    },
  ],

  listFilters: [
    {
      field: "is_active",
      type: "boolean",
      label: "Active Only",
    },
  ],

  defaultSort: { column: "name", direction: "asc" },
  searchableFields: ["name", "contact_name", "contact_email"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "name",
  },

  detailSections: [
    {
      id: "contact",
      title: "Contact Information",
      fields: [
        { field: "name", label: "Company Name" },
        { field: "contact_name", label: "Contact Name" },
        { field: "contact_email", label: "Email" },
        { field: "contact_phone", label: "Phone" },
        { field: "address", label: "Address" },
      ],
    },
    {
      id: "terms",
      title: "Business Terms",
      fields: [
        { field: "payment_terms", label: "Payment Terms" },
        { field: "default_lead_time_days", label: "Lead Time (days)" },
        { field: "is_active", label: "Active" },
      ],
    },
    {
      id: "notes",
      title: "Notes",
      fields: [{ field: "notes", label: "Notes", fullWidth: true }],
      collapsible: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: supplierSchema,

  formFields: [
    {
      name: "name",
      label: "Company Name",
      type: "text",
      placeholder: "e.g., Malteurop",
      required: true,
      colSpan: 6,
    },
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
      placeholder: "e.g., orders@supplier.com",
      colSpan: 6,
    },
    {
      name: "contact_phone",
      label: "Phone",
      type: "text",
      placeholder: "e.g., (555) 123-4567",
      colSpan: 6,
    },
    {
      name: "address",
      label: "Address",
      type: "textarea",
      placeholder: "Street, City, State, ZIP",
      colSpan: 12,
    },
    {
      name: "payment_terms",
      label: "Payment Terms",
      type: "text",
      placeholder: "e.g., Net 30",
      colSpan: 6,
    },
    {
      name: "default_lead_time_days",
      label: "Lead Time (days)",
      type: "number",
      placeholder: "e.g., 14",
      colSpan: 6,
    },
    {
      name: "is_active",
      label: "Active",
      type: "switch",
      description: "Inactive suppliers won't appear in dropdown menus",
      defaultValue: true,
      colSpan: 12,
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      placeholder: "Additional notes about this supplier...",
      colSpan: 12,
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
      detailTab: "Purchase Orders",
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "List all active suppliers",
    "Find suppliers with lead time under 7 days",
    "Show purchase orders for supplier X",
    "Which supplier has the best payment terms?",
  ],

  keyFields: ["name", "contact_name", "contact_email", "default_lead_time_days", "is_active"],
};
