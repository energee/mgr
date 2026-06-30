/**
 * Error Handling Patterns
 *
 * Custom error types and utilities for handling database and application errors.
 * Maps PostgreSQL error codes and constraint names to user-friendly messages,
 * and surfaces the offending column for unique violations so universal save
 * paths can attach the error to the matching form field.
 */

import type { PostgrestError } from "@supabase/supabase-js";

import { PG_ERROR_CODES, PG_ERROR_MESSAGES } from "./pg-error-codes";

// Re-export for backwards compatibility
export { PG_ERROR_CODES, PG_ERROR_MESSAGES };

// =============================================================================
// Custom Error Types
// =============================================================================

/**
 * Validation error for form field validation failures.
 */
export class ValidationError extends Error {
  public readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

/**
 * Database constraint violation error.
 */
export class ConstraintError extends Error {
  public readonly constraint: string;

  constructor(constraint: string, message: string) {
    super(message);
    this.name = "ConstraintError";
    this.constraint = constraint;
  }
}

/**
 * Optimistic locking conflict error.
 */
export class ConcurrentModificationError extends Error {
  constructor() {
    super("Record was modified by another user. Please refresh and try again.");
    this.name = "ConcurrentModificationError";
  }
}

/**
 * Record not found error.
 */
export class NotFoundError extends Error {
  constructor(entityType: string, id?: string) {
    super(id ? `${entityType} not found: ${id}` : `${entityType} not found`);
    this.name = "NotFoundError";
  }
}

/**
 * Authorization/permission error.
 */
export class PermissionError extends Error {
  constructor(action: string) {
    super(`You don't have permission to ${action}`);
    this.name = "PermissionError";
  }
}

/**
 * Map specific constraint names to user-friendly messages.
 * Add entries here as constraints are created in migrations.
 */
export const CONSTRAINT_MESSAGES: Record<string, string> = {
  // Quantity constraints
  chk_quantity_positive: "Quantity must be greater than zero",
  chk_volume_positive: "Volume must be greater than zero",
  chk_amount_positive: "Amount must be greater than zero",
  chk_price_non_negative: "Price cannot be negative",

  // Batch constraints
  chk_batch_volume: "Batch volume must be greater than zero",
  chk_batch_dates: "End date must be after start date",

  // Recipe constraints
  chk_efficiency_range: "Mash efficiency must be between 0 and 100",
  chk_abv_range: "ABV must be between 0 and 100",

  // Order constraints
  chk_order_quantity: "Order quantity must be at least 1",

  // Inventory constraints
  chk_lot_quantity: "Lot quantity must be positive",
  chk_available_quantity: "Available quantity cannot be negative",

  // Status constraints
  chk_valid_status: "Invalid status value",

  // Foreign key constraints (common patterns)
  fk_batch_recipe: "Recipe is required for this batch",
  fk_order_customer: "Customer is required for this order",
  fk_po_supplier: "Supplier is required for this purchase order",

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
export interface ParsedPostgresError {
  message: string;
  /** Column name from a unique violation (e.g. "po_number"), when determinable. */
  field?: string;
}

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
  if (error.code && PG_ERROR_MESSAGES[error.code]) {
    return { message: PG_ERROR_MESSAGES[error.code] };
  }

  // Check for RLS/permission issues
  if (error.message?.includes("row-level security") || error.code === PG_ERROR_CODES.INSUFFICIENT_PRIVILEGE) {
    return { message: "You don't have permission to perform this action" };
  }

  // Fallback to original message (cleaned up)
  return { message: error.message || "An unexpected error occurred" };
}

/**
 * Parse a PostgreSQL/Postgrest error into a user-friendly message.
 */
export function parsePostgresError(error: PostgrestError): string {
  return parsePostgresErrorDetailed(error).message;
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

/**
 * Check if an error is a specific type.
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

export function isConstraintError(error: unknown): error is ConstraintError {
  return error instanceof ConstraintError;
}

export function isConcurrentModificationError(
  error: unknown
): error is ConcurrentModificationError {
  return error instanceof ConcurrentModificationError;
}

export function isNotFoundError(error: unknown): error is NotFoundError {
  return error instanceof NotFoundError;
}

/**
 * Check if a Postgrest error indicates a unique constraint violation.
 */
export function isUniqueViolation(error: PostgrestError): boolean {
  return error.code === PG_ERROR_CODES.UNIQUE_VIOLATION;
}

/**
 * Check if a Postgrest error indicates a foreign key violation.
 */
export function isForeignKeyViolation(error: PostgrestError): boolean {
  return error.code === PG_ERROR_CODES.FOREIGN_KEY_VIOLATION;
}

/**
 * Check if a Postgrest error indicates a check constraint violation.
 */
export function isCheckViolation(error: PostgrestError): boolean {
  return error.code === PG_ERROR_CODES.CHECK_VIOLATION;
}
