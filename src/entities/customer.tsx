/**
 * Customer Entity Configuration
 *
 * Customers include distributors, retailers, taproom sales,
 * and direct-to-consumer accounts.
 */

import { z } from "zod";
import type { EntityConfig, ValueDisplayConfig } from "@/types/entity";
import { valuesAsOptions, getValueDisplay } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { StatusBadge } from "@/components/universal/status-badge";

// Base type from customers table
type CustomerBase = Database["public"]["Tables"]["customers"]["Row"];

// Extended type for list/detail view (includes fields from customers_with_order_summary view)
// Note: View fields are added here since they may not be in generated types yet
interface Customer extends CustomerBase {
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
});

export type CustomerFormValues = z.infer<typeof customerSchema>;

// =============================================================================
// Value Display Configuration
// =============================================================================

const customerTypeDisplayConfig: ValueDisplayConfig = {
  field: "customer_type",
  display: {
    distributor: { label: "Distributor", color: "info" },
    retail: { label: "Retail", color: "success" },
    taproom: { label: "Taproom", color: "warning" },
    direct: { label: "Direct", color: "default" },
  },
};

// =============================================================================
// Entity Configuration
// =============================================================================

export const customerEntity: EntityConfig<Customer> = {
  name: "customer",
  table: "customers",
  viewTable: "customers_with_order_summary",
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
      render: (value) => {
        const display = getValueDisplay(customerEntity, "customer_type", value as string);
        return (
          <StatusBadge
            status={value as string}
            config={display ? { [value as string]: { label: display.label, color: display.color || "default" } } : undefined}
          />
        );
      },
    },
    {
      accessorKey: "sales_channel_name",
      header: "Channel",
      sortable: true,
    },
    {
      accessorKey: "total_orders",
      header: "Orders",
      sortable: true,
      format: "number",
    },
    {
      accessorKey: "total_revenue",
      header: "Revenue",
      sortable: true,
      format: "currency",
    },
    {
      accessorKey: "last_order_date",
      header: "Last Order",
      sortable: true,
      format: "date",
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
      options: valuesAsOptions(customerTypeDisplayConfig),
    },
    {
      field: "is_active",
      type: "boolean",
      label: "Active",
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
      id: "pricing",
      title: "Pricing",
      fields: [
        { field: "sales_channel_name", label: "Sales Channel" },
        { field: "price_tier_name", label: "Price Tier" },
      ],
    },
    {
      id: "order_summary",
      title: "Order Summary",
      fields: [
        { field: "total_orders", label: "Total Orders", format: "number" },
        { field: "total_revenue", label: "Total Revenue", format: "currency" },
        { field: "pending_orders", label: "Pending Orders", format: "number" },
        { field: "pending_revenue", label: "Pending Revenue", format: "currency" },
        { field: "last_order_date", label: "Last Order", format: "date" },
      ],
    },
    {
      id: "keg_balance",
      title: "Keg Balance",
      fields: [
        { field: "total_kegs_out", label: "Total Kegs Out", format: "number" },
        { field: "total_deposit_value", label: "Deposit Value", format: "currency" },
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
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
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
          options: valuesAsOptions(customerTypeDisplayConfig),
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
      ],
    },
    {
      id: "pricing",
      title: "Pricing",
      fields: [
        {
          name: "sales_channel_id",
          label: "Sales Channel",
          type: "select",
          description: "Determines default pricing tier",
          dynamicOptions: {
            table: "sales_channels",
            valueField: "id",
            labelField: "name",
            filter: { is_active: true },
          },
          colSpan: 6,
        },
        {
          name: "price_tier_id",
          label: "Price Tier Override",
          type: "select",
          description: "Override default tier pricing (optional)",
          dynamicOptions: {
            table: "pricing_tiers",
            valueField: "id",
            labelField: "name",
            orderBy: "cogs_max",
          },
          colSpan: 6,
        },
      ],
    },
    {
      id: "order_summary",
      title: "Order Summary",
      fields: [
        {
          name: "total_orders",
          label: "Total Orders",
          format: "number",
          editable: false,
          colSpan: 4,
        },
        {
          name: "total_revenue",
          label: "Total Revenue",
          format: "currency",
          editable: false,
          colSpan: 4,
        },
        {
          name: "last_order_date",
          label: "Last Order",
          format: "date",
          editable: false,
          colSpan: 4,
        },
        {
          name: "pending_orders",
          label: "Pending Orders",
          format: "number",
          editable: false,
          colSpan: 6,
        },
        {
          name: "pending_revenue",
          label: "Pending Revenue",
          format: "currency",
          editable: false,
          colSpan: 6,
        },
      ],
    },
    {
      id: "keg_balance",
      title: "Keg Balance",
      fields: [
        {
          name: "total_kegs_out",
          label: "Total Kegs Out",
          format: "number",
          editable: false,
          colSpan: 6,
        },
        {
          name: "total_deposit_value",
          label: "Deposit Value",
          format: "currency",
          editable: false,
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
          placeholder: "Delivery preferences, payment terms...",
          fullWidth: true,
        },
      ],
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
      options: valuesAsOptions(customerTypeDisplayConfig),
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
      name: "sales_channel_id",
      label: "Sales Channel",
      type: "select",
      description: "Determines default pricing tier",
      dynamicOptions: {
        table: "sales_channels",
        valueField: "id",
        labelField: "name",
        filter: { is_active: true },
      },
      colSpan: 6,
    },
    {
      name: "price_tier_id",
      label: "Price Tier Override",
      type: "select",
      description: "Override default tier pricing (optional)",
      dynamicOptions: {
        table: "pricing_tiers",
        valueField: "id",
        labelField: "name",
        orderBy: "cogs_max",
      },
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
  // Value Display
  // ---------------------------------------------------------------------------
  valueDisplay: [customerTypeDisplayConfig],

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
