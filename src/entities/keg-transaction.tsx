/**
 * Keg Transaction Entity Configuration
 *
 * Immutable audit log for all keg state transitions.
 * Following the allocations pattern: transactions are immutable records,
 * and keg inventory quantities are CALCULATED from these transactions via views.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import { KEG_STATES, type KegState } from "./keg-inventory";

// Derive the keg state enum values from KEG_STATES (single source of truth)
const KEG_STATE_VALUES = KEG_STATES.map((s) => s.value) as [KegState, ...KegState[]];

// =============================================================================
// Types
// =============================================================================

export type KegTransactionType =
  | "receive"
  | "fill"
  | "ship"
  | "return"
  | "clean"
  | "adjust"
  | "retire"
  | "maintain";

type KegTransaction = {
  id: string;
  transaction_type: KegTransactionType;
  selling_format_id: string;
  quantity: number;
  from_state: KegState | null;
  to_state: KegState | null;
  from_location_id: string | null;
  to_location_id: string | null;
  order_id: string | null;
  customer_id: string | null;
  packaging_session_id: string | null;
  batch_id: string | null;
  finished_good_id: string | null;
  keg_owner_id: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: string | null;
  // Convenience display fields populated by the view from selling_formats/containers
  keg_type_name?: string;
  volume_bbl?: number;
  keg_owner_name?: string;
  customer_name?: string;
  order_number?: string;
  batch_number?: string;
  finished_good_name?: string;
  from_location_name?: string;
  to_location_name?: string;
}

// =============================================================================
// Transaction Type Options
// =============================================================================

export const TRANSACTION_TYPES: {
  value: KegTransactionType;
  label: string;
  description: string;
  fromState: KegState | null;
  toState: KegState;
}[] = [
  {
    value: "receive",
    label: "Receive",
    description: "New kegs entering inventory",
    fromState: null,
    toState: "empty",
  },
  {
    value: "fill",
    label: "Fill",
    description: "Fill empty kegs with beer",
    fromState: "empty",
    toState: "filled",
  },
  {
    value: "ship",
    label: "Ship",
    description: "Ship filled kegs to customer",
    fromState: "filled",
    toState: "shipped",
  },
  {
    value: "return",
    label: "Return",
    description: "Customer returns kegs",
    fromState: "shipped",
    toState: "returned_dirty",
  },
  {
    value: "clean",
    label: "Clean",
    description: "Clean dirty kegs",
    fromState: "returned_dirty",
    toState: "empty",
  },
  {
    value: "maintain",
    label: "Maintenance",
    description: "Send kegs for repair",
    fromState: null, // Can be from any state
    toState: "maintenance",
  },
  {
    value: "retire",
    label: "Retire",
    description: "Remove kegs from service",
    fromState: null, // Can be from any state
    toState: "retired",
  },
  {
    value: "adjust",
    label: "Adjust",
    description: "Manual inventory adjustment",
    fromState: null,
    toState: "empty", // Default, but can be any state
  },
];

// Derive transaction type enum values from TRANSACTION_TYPES (single source of truth)
const TRANSACTION_TYPE_VALUES = TRANSACTION_TYPES.map((t) => t.value) as [KegTransactionType, ...KegTransactionType[]];

// =============================================================================
// Zod Schema
// =============================================================================

export const kegTransactionSchema = z.object({
  transaction_type: z.enum(TRANSACTION_TYPE_VALUES),
  selling_format_id: z.string().uuid("Select a selling format"),
  keg_owner_id: z.string().uuid().nullable().optional(),
  quantity: z.coerce.number().int().positive("Quantity must be at least 1"),
  from_state: z.enum(KEG_STATE_VALUES).nullable().optional(),
  to_state: z.enum(KEG_STATE_VALUES).nullable().optional(),
  from_location_id: z.string().uuid().nullable().optional(),
  to_location_id: z.string().uuid().nullable().optional(),
  order_id: z.string().uuid().nullable().optional(),
  customer_id: z.string().uuid().nullable().optional(),
  packaging_session_id: z.string().uuid().nullable().optional(),
  batch_id: z.string().uuid().nullable().optional(),
  finished_good_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_by_name: z.string().nullable().optional(),
}).refine(
  (data) => {
    // Fill transactions require a batch or finished good link for traceability
    if (data.transaction_type === "fill") {
      return !!data.batch_id || !!data.finished_good_id;
    }
    return true;
  },
  {
    message: "Fill transactions require a linked batch or finished good",
    path: ["batch_id"],
  }
).refine(
  (data) => {
    // Ship and return transactions require a customer for keg tracking
    if (data.transaction_type === "ship" || data.transaction_type === "return") {
      return !!data.customer_id;
    }
    return true;
  },
  {
    message: "Ship and return transactions require a customer",
    path: ["customer_id"],
  }
);

export type KegTransactionFormValues = z.infer<typeof kegTransactionSchema>;

// =============================================================================
// Entity Configuration
// =============================================================================

export const kegTransactionEntity: EntityConfig<KegTransaction> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "keg_transaction",
  table: "keg_transactions",
  displayName: "Keg Transaction",
  displayNamePlural: "Keg Transactions",
  description: "Immutable audit log for keg state transitions (inventory calculated from these records)",
  domain: "inventory",

  // Use the view for list display (includes joined names)
  viewTable: "keg_transactions_with_details",

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

  defaultSort: { column: "created_at", direction: "desc" },
  searchableFields: ["customer_name", "batch_number", "notes"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "transaction_type",
    subtitle: "created_at",
  },

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
          relation: { entity: "batch", displayField: "batch_number" },
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

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: kegTransactionSchema,

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show recent keg transactions",
    "How many kegs were shipped this month?",
    "List all keg returns from customer X",
    "Show fill transactions for batch Y",
  ],

  keyFields: ["transaction_type", "selling_format_id", "keg_owner_id", "quantity", "from_state", "to_state", "created_at"],
};
