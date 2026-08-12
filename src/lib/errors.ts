/**
 * Error Handling Patterns
 *
 * Custom error types and utilities for handling database and application errors.
 * Maps PostgreSQL error codes and constraint names to user-friendly messages,
 * and surfaces the offending column for unique violations so universal save
 * paths can attach the error to the matching form field.
 */

import type { PostgrestError } from "@supabase/supabase-js";

import { PG_ERROR_CODES, PG_ERROR_TABLE } from "./pg-error-codes";

// Re-exported for the client components that consume the codes through this module.
export { PG_ERROR_CODES };

/**
 * Map specific constraint names to user-friendly messages.
 * Only constraints that exist in migrations AND whose curated message beats
 * the generic code-level fallback belong here.
 */
export const CONSTRAINT_MESSAGES: Record<string, string> = {
  // Unique hand-typed identifier fields (constraint names from migrations
  // 00002/00004/00010) — these collide when users type a number that exists
  purchase_orders_po_number_key: "This PO number is already in use",
  orders_order_number_key: "This order number is already in use",
  batches_batch_number_key: "This batch number is already in use",
  brew_logs_brew_number_key: "This brew number is already in use",

  // Keg transaction state-transition checks (migration 00032_keg_transactions)
  valid_fill_transaction:
    "Fill transactions must go from Empty to Filled and reference a batch or finished good",
  valid_ship_transaction:
    "Ship transactions must go from Filled to Shipped and reference a customer",
  valid_return_transaction:
    "Return transactions must go from Shipped to Returned (Dirty) and reference a customer",
  valid_clean_transaction:
    "Clean transactions must go from Returned (Dirty) or Cleaning to Cleaning or Empty",
  valid_receive_transaction:
    "Received kegs must enter in the Empty state",
  valid_retire_transaction:
    "Retire transactions must end in the Retired state",
  valid_maintain_transaction:
    "Maintain transactions must end in the Maintenance state",
};

// =============================================================================
// Error Parsing Utilities
// =============================================================================

/**
 * Extract a constraint name from a Postgres error message, if present.
 */
function extractConstraintMessage(errorMessage: string | undefined): string | null {
  if (!errorMessage) return null;
  const match = errorMessage.match(/constraint "(\w+)"/);
  if (match && CONSTRAINT_MESSAGES[match[1]]) {
    return CONSTRAINT_MESSAGES[match[1]];
  }
  return null;
}

/** Error codes that carry constraint names in their messages. */
const CONSTRAINT_ERROR_CODES: ReadonlySet<string> = new Set([
  PG_ERROR_CODES.UNIQUE_VIOLATION,
  PG_ERROR_CODES.FOREIGN_KEY_VIOLATION,
  PG_ERROR_CODES.CHECK_VIOLATION,
]);

/**
 * Result of parsing a Postgres error: a user-friendly message, plus the
 * offending column for single-column unique violations so callers can land
 * the message on the matching form field (react-hook-form `setError`)
 * instead of a toast.
 */
export type ParsedPostgresError = {
  message: string;
  /** Column name from a unique violation (e.g. "po_number"), when determinable. */
  field?: string;
};

/**
 * Extract the column and value from a unique-violation `details` string:
 * `Key (po_number)=(PO-2025-001) already exists.`
 * Returns null for composite keys (multiple columns) — those can't map to a
 * single form field.
 */
function extractUniqueViolationKey(
  details: string | undefined
): { field: string; value: string } | null {
  if (!details) return null;
  const match = details.match(/Key \((\w+)\)=\((.*)\) already exists/);
  if (!match) return null;
  return { field: match[1], value: match[2] };
}

/**
 * Parse a PostgreSQL/Postgrest error into a user-friendly message plus, for
 * single-column unique violations, the offending column name.
 */
export function parsePostgresErrorDetailed(
  error: PostgrestError
): ParsedPostgresError {
  // Check for constraint violations (unique, foreign key, check)
  if (error.code && CONSTRAINT_ERROR_CODES.has(error.code)) {
    const key =
      error.code === PG_ERROR_CODES.UNIQUE_VIOLATION
        ? extractUniqueViolationKey(error.details)
        : null;
    const constraintMsg = extractConstraintMessage(error.message);
    if (constraintMsg) {
      return { message: constraintMsg, field: key?.field };
    }
    if (key) {
      // No curated constraint message — name the colliding value directly
      return { message: `"${key.value}" is already in use`, field: key.field };
    }
    // Fall through to standard message mapping for the error code
  }

  // Use standard message mapping
  const tableMessage = error.code ? PG_ERROR_TABLE[error.code]?.message : undefined;
  if (tableMessage) {
    return { message: tableMessage };
  }

  // RLS denials that surface without a mapped code
  if (error.message?.includes("row-level security")) {
    return { message: PG_ERROR_TABLE[PG_ERROR_CODES.INSUFFICIENT_PRIVILEGE].message };
  }

  // Fallback to original message (cleaned up)
  return { message: error.message || "An unexpected error occurred" };
}

/**
 * Parse an unknown caught value (typed `unknown` in catch blocks / mutation
 * onError) into a friendly message + optional field. Handles Postgres errors
 * (objects carrying a `code`), plain `Error` instances (hand-written guard
 * messages pass through verbatim), and anything else via a generic fallback.
 */
export function parseUnknownError(err: unknown): ParsedPostgresError {
  if (err && typeof err === "object" && "code" in err) {
    const pgErr = err as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
    if (typeof pgErr.code === "string") {
      return parsePostgresErrorDetailed({
        code: pgErr.code,
        message: typeof pgErr.message === "string" ? pgErr.message : "",
        details: typeof pgErr.details === "string" ? pgErr.details : "",
        hint: typeof pgErr.hint === "string" ? pgErr.hint : "",
        name: "PostgrestError",
      } as PostgrestError);
    }
  }
  if (err instanceof Error && err.message) {
    return { message: err.message };
  }
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message) return { message };
  }
  return { message: "An unexpected error occurred" };
}
