/**
 * Keg Transaction Entity — presentation
 *
 * The React/UI half of the keg transaction entity: list columns, list filters,
 * and the unified detail/edit sections.
 */

import type { EntityPresentation } from "@/types/entity";
import { KEG_STATES } from "@/entities/keg-inventory/core";
import type { KegTransaction } from "./core";
import { TRANSACTION_TYPES } from "./core";

export const kegTransactionPresentation: EntityPresentation<KegTransaction> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "created_at",
      header: "Date",
      sortable: true,
      render: (value: unknown) => {
        if (!value) return "—";
        return new Date(value as string).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
      },
    },
    {
      accessorKey: "transaction_type",
      header: "Type",
      sortable: true,
      render: (value: unknown) => {
        const type = TRANSACTION_TYPES.find((t) => t.value === value);
        return type?.label || String(value);
      },
    },
    {
      accessorKey: "keg_type_name",
      header: "Keg Type",
      sortable: true,
    },
    {
      accessorKey: "keg_owner_name",
      header: "Owner",
      sortable: true,
      render: (value: unknown) => (value ? String(value) : "—"),
    },
    {
      accessorKey: "quantity",
      header: "Qty",
      sortable: true,
    },
    {
      accessorKey: "from_state",
      header: "From",
      sortable: false,
      render: (value: unknown) => {
        if (!value) return "—";
        const state = KEG_STATES.find((s) => s.value === value);
        return state?.label || String(value);
      },
    },
    {
      accessorKey: "to_state",
      header: "To",
      sortable: false,
      render: (value: unknown) => {
        if (!value) return "—";
        const state = KEG_STATES.find((s) => s.value === value);
        return state?.label || String(value);
      },
    },
    {
      accessorKey: "customer_name",
      header: "Customer",
      sortable: true,
      render: (value: unknown) => (value ? String(value) : "—"),
    },
  ],

  listFilters: [
    {
      field: "transaction_type",
      type: "select",
      label: "Type",
      options: TRANSACTION_TYPES.map((t) => ({ value: t.value, label: t.label })),
    },
  ],

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Transaction Details",
      fields: [
        {
          name: "transaction_type",
          label: "Transaction Type",
          type: "select",
          options: TRANSACTION_TYPES.map((t) => ({
            value: t.value,
            label: `${t.label} - ${t.description}`,
          })),
          required: true,
          colSpan: 6,
        },
        {
          name: "selling_format_id",
          label: "Keg Type",
          type: "relation",
          relation: { entity: "selling_format", displayField: "name" },
          required: true,
          colSpan: 6,
        },
        {
          name: "keg_owner_id",
          label: "Keg Owner",
          type: "relation",
          relation: { entity: "keg_owner", displayField: "name" },
          description: "Fleet provider (e.g., Owned, Microstar, KegFleet)",
          colSpan: 6,
        },
        {
          name: "quantity",
          label: "Quantity",
          type: "number",
          placeholder: "1",
          required: true,
          colSpan: 6,
        },
        {
          name: "from_state",
          label: "From State",
          type: "select",
          options: [
            { value: "_none", label: "None (New Kegs)" },
            ...KEG_STATES.map((s) => ({ value: s.value, label: s.label })),
          ],
          colSpan: 6,
          showWhen: (values: Partial<KegTransaction>) =>
            ["maintain", "retire", "adjust"].includes(values.transaction_type || ""),
        },
        {
          name: "to_state",
          label: "To State",
          type: "select",
          options: KEG_STATES.map((s) => ({ value: s.value, label: s.label })),
          colSpan: 6,
          showWhen: (values: Partial<KegTransaction>) =>
            values.transaction_type === "adjust",
        },
        {
          name: "from_location_id",
          label: "From Location",
          type: "relation",
          relation: { entity: "location", displayField: "name" },
          colSpan: 6,
        },
        {
          name: "to_location_id",
          label: "To Location",
          type: "relation",
          relation: { entity: "location", displayField: "name" },
          colSpan: 6,
        },
        {
          name: "from_bin_id",
          label: "From Bin",
          type: "relation",
          relation: { entity: "bin", displayField: "name" },
          description: "On-premise bin the kegs left (blank = off-premise)",
          colSpan: 6,
        },
        {
          name: "to_bin_id",
          label: "To Bin",
          type: "relation",
          relation: { entity: "bin", displayField: "name" },
          description: "On-premise bin the kegs entered (blank = off-premise)",
          colSpan: 6,
        },
      ],
    },
    {
      id: "related",
      title: "Related Records",
      fields: [
        {
          name: "customer_id",
          label: "Customer",
          type: "relation",
          relation: { entity: "customer", displayField: "name" },
          description: "Required for ship/return transactions",
          colSpan: 6,
        },
        {
          name: "order_id",
          label: "Order",
          type: "relation",
          relation: { entity: "order", displayField: "order_number" },
          description: "Optional: Link to sales order",
          colSpan: 6,
        },
        {
          name: "batch_id",
          label: "Batch",
          type: "relation",
          relation: { entity: "batch", displayField: "batch_code" },
          description: "Required for fill transactions",
          colSpan: 6,
        },
        {
          name: "finished_good_id",
          label: "Finished Good",
          type: "relation",
          relation: { entity: "finished_good", displayField: "lot_number" },
          description: "Required for fill transactions",
          colSpan: 6,
        },
      ],
    },
    {
      id: "audit",
      title: "Audit Information",
      fields: [
        {
          name: "notes",
          label: "Notes",
          type: "textarea",
          placeholder: "Optional notes about this transaction",
          colSpan: 12,
        },
        {
          name: "created_by_name",
          label: "Created By",
          editable: false,
          colSpan: 6,
        },
        {
          name: "created_at",
          label: "Created At",
          format: "datetime",
          editable: false,
          colSpan: 6,
        },
      ],
    },
  ],
};
