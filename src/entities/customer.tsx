/**
 * Customer Entity Configuration
 *
 * Customers include distributors, retailers, taproom sales,
 * and direct-to-consumer accounts.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { StatusBadge } from "@/components/universal/status-badge";

type Customer = Database["public"]["Tables"]["customers"]["Row"];

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
  notes: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
});

export type CustomerFormValues = z.infer<typeof customerSchema>;

// Customer type display config
const customerTypeDisplay: Record<string, { label: string; color: "default" | "success" | "warning" | "error" | "info" }> = {
  distributor: { label: "Distributor", color: "info" },
  retail: { label: "Retail", color: "success" },
  taproom: { label: "Taproom", color: "warning" },
  direct: { label: "Direct", color: "default" },
};

// =============================================================================
// Entity Configuration
// =============================================================================

export const customerEntity: EntityConfig<Customer> = {
  name: "customer",
  table: "customers",
  displayName: "Customer",
  displayNamePlural: "Customers",
  description: "Distributors, retailers, and direct customers",
  domain: "sales",

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
      accessorKey: "customer_type",
      header: "Type",
      sortable: true,
      render: (value) => (
        <StatusBadge
          status={value as string}
          config={customerTypeDisplay}
        />
      ),
    },
    {
      accessorKey: "contact_name",
      header: "Contact",
      sortable: true,
    },
    {
      accessorKey: "email",
      header: "Email",
      sortable: true,
    },
    {
      accessorKey: "phone",
      header: "Phone",
      sortable: true,
    },
    {
      accessorKey: "is_active",
      header: "Active",
      sortable: true,
      render: (value) => value ? "Yes" : "No",
    },
  ],

  listFilters: [
    {
      field: "customer_type",
      type: "multiselect",
      label: "Type",
      options: [
        { value: "distributor", label: "Distributor" },
        { value: "retail", label: "Retail" },
        { value: "taproom", label: "Taproom" },
        { value: "direct", label: "Direct" },
      ],
    },
    {
      field: "is_active",
      type: "boolean",
      label: "Active Only",
    },
  ],

  defaultSort: { column: "name", direction: "asc" },
  searchableFields: ["name", "contact_name", "email"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "name",
    subtitle: "customer_type",
  },

  detailSections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        { field: "name", label: "Company Name" },
        { field: "customer_type", label: "Customer Type" },
        { field: "is_active", label: "Active" },
      ],
    },
    {
      id: "contact",
      title: "Contact Information",
      fields: [
        { field: "contact_name", label: "Contact Name" },
        { field: "email", label: "Email" },
        { field: "phone", label: "Phone" },
      ],
    },
    {
      id: "notes",
      title: "Notes",
      fields: [
        { field: "notes", label: "Notes", fullWidth: true },
      ],
      collapsible: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: customerSchema,

  formFields: [
    {
      name: "name",
      label: "Company Name",
      type: "text",
      placeholder: "e.g., Downtown Distributors",
      required: true,
      colSpan: 6,
    },
    {
      name: "customer_type",
      label: "Customer Type",
      type: "select",
      required: true,
      options: [
        { value: "distributor", label: "Distributor" },
        { value: "retail", label: "Retail" },
        { value: "taproom", label: "Taproom" },
        { value: "direct", label: "Direct" },
      ],
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
      name: "email",
      label: "Email",
      type: "text",
      placeholder: "e.g., john@example.com",
      colSpan: 6,
    },
    {
      name: "phone",
      label: "Phone",
      type: "text",
      placeholder: "e.g., 555-0100",
      colSpan: 6,
    },
    {
      name: "is_active",
      label: "Active",
      type: "switch",
      description: "Inactive customers won't appear in order selection",
      defaultValue: true,
      colSpan: 6,
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      placeholder: "Delivery preferences, payment terms...",
      colSpan: 12,
    },
  ],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show me all distributors",
    "List active retail accounts",
    "Find customer by email",
    "What customers are in Seattle?",
  ],

  keyFields: ["name", "customer_type", "contact_name", "email", "is_active"],
};
