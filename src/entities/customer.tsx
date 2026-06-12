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
import { createQBOSyncDisplay } from "@/components/domain/shared/qbo-sync-section";
import { CustomerShippingPreferences } from "@/components/domain/order/customer-shipping-preferences";
import { CustomerPalletConfigs } from "@/components/domain/order/customer-pallet-configs";
import { CustomerOrdersRelation } from "@/components/domain/order/customer-orders-relation";
import { CustomerAddressSection } from "@/components/domain/order/customer-address-section";

// =============================================================================
// Section Component Wrappers
// =============================================================================

// Adapter: extracts customerId from section data for CustomerShippingPreferences
function CustomerShippingPreferencesSection({ data }: { data: { id: string } }) {
  if (!data?.id) return null;
  return <CustomerShippingPreferences customerId={data.id} />;
}

// Adapter: extracts customerId from section data for CustomerPalletConfigs
function CustomerPalletConfigsSection({ data }: { data: { id: string } }) {
  if (!data?.id) return null;
  return <CustomerPalletConfigs customerId={data.id} />;
}

// Base type from customers table
type CustomerBase = Database["public"]["Tables"]["customers"]["Row"];

// Extended type for list/detail view (includes fields from customers_with_order_summary view)
// Note: View fields are added here since they may not be in generated types yet
type Customer = CustomerBase & {
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
  // JSONB billing address. Edited via the CustomerAddressSection custom
  // section, which writes normalized keys (street/line2/city/state/zip/
  // country) matching what QuickBooks export reads via mapAddress()
  // (src/integrations/quickbooks/sync-utils.ts).
  address: z.any().nullable().optional(),
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
      // Billing address (customers.address JSONB) — custom section because
      // the unified field grid has no JSONB editor. Synced to QuickBooks as
      // BillAddr (see mapAddress in src/integrations/quickbooks/sync-utils.ts).
      id: "billing-address",
      title: "Billing Address",
      component: CustomerAddressSection,
    },
    {
      id: "pricing",
      title: "Pricing",
      fields: [
        {
          name: "sales_channel_id",
          label: "Sales Channel",
          type: "relation",
          description: "Determines default pricing tier",
          relation: {
            entity: "sales_channel",
            displayField: "name",
          },
          colSpan: 6,
        },
        {
          name: "price_tier_id",
          label: "Price Tier Override",
          type: "relation",
          description: "Override default tier pricing (optional)",
          relation: {
            entity: "pricing_tier",
            displayField: "name",
          },
          colSpan: 6,
        },
      ],
    },
    {
      id: "billing",
      title: "Billing",
      fields: [
        {
          name: "payment_terms_days",
          label: "Payment Terms (days)",
          type: "number",
          placeholder: "e.g., 30",
          description: "Days until invoice is due. Falls back to system default if empty.",
          colSpan: 6,
        },
        {
          name: "is_tax_exempt",
          label: "Tax Exempt",
          type: "switch",
          description: "Exempt this customer from tax in QuickBooks",
          defaultValue: false,
          colSpan: 6,
        },
      ],
    },
    {
      id: "shipping-preferences",
      title: "Shipping Preferences",
      component: CustomerShippingPreferencesSection,
      collapsible: true,
    },
    {
      id: "pallet-configs",
      title: "Pallet Configurations",
      component: CustomerPalletConfigsSection,
      collapsible: true,
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
      id: "qbo-sync",
      title: "QuickBooks",
      component: createQBOSyncDisplay("customer"),
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

  // ---------------------------------------------------------------------------
  // Value Display
  // ---------------------------------------------------------------------------
  valueDisplay: [customerTypeDisplayConfig],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      // Custom component instead of the generic RelationTable: adds the
      // "Reorder last" button (duplicates the most recent non-cancelled
      // order as a new draft with prices re-resolved — see
      // src/components/domain/order/reorder.ts) while keeping the standard
      // Add link and row navigation.
      name: "orders",
      entity: "order",
      type: "hasMany",
      foreignKey: "customer_id",
      showInDetail: true,
      detailTab: "Orders",
      component: CustomerOrdersRelation,
    },
  ],

  // Framework Duplicate action (EntityDetailUnified): no identity fields
  // beyond the framework baseline — name carries over for the user to tweak
  // (a unique violation surfaces on the field at save time). Order-summary
  // stats are display-only view columns and never carry over.
  excludeOnDuplicate: [],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "send_portal_invite",
      label: "Send Portal Invite",
      icon: "mail",
      type: "dropdown",
      confirm: true,
    },
    {
      name: "delete",
      label: "Delete Customer",
      icon: "trash",
      type: "dropdown",
      variant: "destructive",
      deleteMode: "hard",
    },
  ],
};
