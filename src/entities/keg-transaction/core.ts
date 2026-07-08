/**
 * Keg Transaction Entity — server-safe core
 *
 * The pure-data half of the keg transaction entity: identity, the zod form
 * schema, transaction type constants, and AI metadata. No React imports —
 * safe to import from server route handlers and API routes.
 *
 * Immutable audit log for all keg state transitions. Keg inventory quantities
 * are CALCULATED from these transactions via views.
 */

import { z } from "zod";
import type { EntityCoreInput } from "@/types/entity";
import { KEG_STATES, type KegState } from "@/entities/keg-inventory/core";

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

export type KegTransaction = {
  id: string;
  transaction_type: KegTransactionType;
  selling_format_id: string;
  quantity: number;
  from_state: KegState | null;
  to_state: KegState | null;
  from_location_id: string | null;
  to_location_id: string | null;
  from_bin_id: string | null;
  to_bin_id: string | null;
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
  batch_code?: string;
  finished_good_name?: string;
  from_location_name?: string;
  to_location_name?: string;
};

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

const baseKegTransactionSchema = z.object({
  transaction_type: z.enum(TRANSACTION_TYPE_VALUES),
  selling_format_id: z.string().uuid("Select a selling format"),
  keg_owner_id: z.string().uuid().nullable().optional(),
  quantity: z.coerce.number().int().positive("Quantity must be at least 1"),
  from_state: z.enum(KEG_STATE_VALUES).nullable().optional(),
  to_state: z.enum(KEG_STATE_VALUES).nullable().optional(),
  from_location_id: z.string().uuid().nullable().optional(),
  to_location_id: z.string().uuid().nullable().optional(),
  // Bin dimension (00220): on-premise bin the kegs left/entered; NULL = off-premise.
  from_bin_id: z.string().uuid().nullable().optional(),
  to_bin_id: z.string().uuid().nullable().optional(),
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

/**
 * Derive from_state/to_state from the selected transaction_type before
 * validation. keg_transactions.to_state is NOT NULL with per-type CHECK
 * constraints (00032), yet the form may hide the state selects — so we fill
 * DB-valid states here for every entry point (e.g. the bare
 * /inventory/kegs/transactions/new page) from TRANSACTION_TYPES.
 */
function deriveStatesFromType(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const data = raw as Record<string, unknown>;
  const typeConfig = TRANSACTION_TYPES.find(
    (t) => t.value === data.transaction_type,
  );
  if (!typeConfig) return raw;

  if (typeConfig.value === "adjust") {
    // `||` (not `??`) so an empty-string select value also falls back.
    return { ...data, to_state: data.to_state || typeConfig.toState };
  }

  if (typeConfig.value === "maintain" || typeConfig.value === "retire") {
    return { ...data, to_state: typeConfig.toState };
  }

  return {
    ...data,
    from_state: typeConfig.fromState,
    to_state: typeConfig.toState,
  };
}

/**
 * Form schema with type→state derivation applied before validation, so the
 * parsed output (inserted verbatim by entity-detail-unified) always carries
 * DB-valid from_state/to_state even when the selects are hidden.
 */
export const kegTransactionSchema = z.preprocess(
  deriveStatesFromType,
  baseKegTransactionSchema,
);

export type KegTransactionFormValues = z.infer<typeof kegTransactionSchema>;

// =============================================================================
// Entity Core
// =============================================================================

export const kegTransactionCore: EntityCoreInput<KegTransaction> = {
  name: "keg_transaction",
  table: "keg_transactions",
  // Use the view for list display (includes joined names)
  viewTable: "keg_transactions_with_details",
  displayName: "Keg Transaction",
  description: "Immutable audit log for keg state transitions (inventory calculated from these records)",
  domain: "inventory",
  basePath: "/inventory/kegs/transactions",

  // Explicit: sort by most-recent first, not by name.
  defaultSort: { column: "created_at", direction: "desc" },
  searchableFields: ["customer_name", "batch_code", "notes"],

  detailHeader: {
    title: "transaction_type",
    subtitle: "created_at",
  },

  formSchema: kegTransactionSchema,

  queryExamples: [
    "Show recent keg transactions",
    "How many kegs were shipped this month?",
    "List all keg returns from customer X",
    "Show fill transactions for batch Y",
  ],

  keyFields: ["transaction_type", "selling_format_id", "keg_owner_id", "quantity", "from_state", "to_state", "created_at"],
};
