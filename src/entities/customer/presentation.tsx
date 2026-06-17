/**
 * Customer Entity — presentation
 *
 * The React/UI half of the customer entity: list columns, list filters, the
 * unified detail/edit sections, and actions. Includes section-level component
 * adapters for shipping preferences, pallet configs, and QBO sync.
 */

import type { EntityPresentation } from "@/types/entity";
import { deleteAction } from "@/types/entity";
import { getValueDisplay } from "@/types/entity";
import { StatusBadge } from "@/components/universal/status-badge";
import { createQBOSyncDisplay } from "@/components/domain/shared/qbo-sync-section";
import { CustomerShippingPreferences } from "@/components/domain/order/customer-shipping-preferences";
import { CustomerPalletConfigs } from "@/components/domain/order/customer-pallet-configs";
import { customerCore, customerTypeOptions } from "./core";
import type { Customer } from "./core";

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

export const customerPresentation: EntityPresentation<Customer> = {
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
        const display = getValueDisplay(customerCore, "customer_type", value as string);
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
      options: customerTypeOptions,
    },
    {
      field: "is_active",
      type: "boolean",
      label: "Active",
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
          options: customerTypeOptions,
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
    deleteAction("Customer"),
  ],
};
