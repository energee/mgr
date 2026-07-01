/**
 * Supplier Entity — presentation
 *
 * The React/UI half of the supplier entity: list columns, list filters, and
 * the unified detail/edit sections (including the QuickBooks sync section).
 */

import type { EntityPresentation } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { Badge } from "@/components/ui/badge";
import { createQBOSyncDisplay } from "@/components/domain/shared/qbo-sync-section";
import { SupplierCatalogSection } from "@/components/domain/purchasing/supplier-catalog-section";

type Supplier = Database["public"]["Tables"]["suppliers"]["Row"];

export const supplierPresentation: EntityPresentation<Supplier> = {
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
  // Relation components — woven onto `core.relations` by createEntityConfig()
  // ---------------------------------------------------------------------------
  relationComponents: {
    catalog_items: SupplierCatalogSection,
  },

  // Duplicate carries over reusable supplier attributes.
  excludeOnDuplicate: [],
};
