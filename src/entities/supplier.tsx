/**
 * Supplier Entity Configuration
 *
 * Suppliers provide ingredients and materials for brewing.
 * Includes contact info, payment terms, and lead time tracking.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { Badge } from "@/components/ui/badge";

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

  detailSections: [
    {
      id: "contact",
      title: "Contact Information",
      fields: [
        { field: "contact_name", label: "Contact Name" },
        { field: "contact_email", label: "Email" },
        { field: "contact_phone", label: "Phone" },
      ],
    },
    {
      id: "terms",
      title: "Terms & Logistics",
      fields: [
        { field: "payment_terms", label: "Payment Terms" },
        { field: "default_lead_time_days", label: "Default Lead Time (days)" },
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

  formFields: [
    {
      name: "name",
      label: "Supplier Name",
      type: "text",
      placeholder: "e.g., Briess Malt & Ingredients",
      required: true,
      colSpan: 12,
    },
    {
      name: "is_active",
      label: "Active",
      type: "switch",
      defaultValue: true,
      colSpan: 12,
      description: "Inactive suppliers won't appear in purchase order creation",
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
      colSpan: 6,
      description: "Typical days between order and delivery",
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      placeholder: "Additional information about this supplier...",
      colSpan: 12,
    },
  ],

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
      deleteMode: "hard" as const,
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
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "List all active suppliers",
    "Find suppliers with lead time under 7 days",
    "Show suppliers for malt ingredients",
    "Which suppliers have Net 30 terms?",
  ],

  keyFields: ["name", "is_active", "payment_terms", "default_lead_time_days"],
};
