/**
 * Error Handling Patterns
 *
 * Custom error types and utilities for handling database and application errors.
 * Maps PostgreSQL error codes to user-friendly messages.
 */

import type { PostgrestError } from "@supabase/supabase-js";

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

// =============================================================================
// PostgreSQL Error Code Mapping
// =============================================================================

/**
 * Map PostgreSQL error codes to user-friendly messages.
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export const PG_ERROR_MESSAGES: Record<string, string> = {
  // Class 23 - Integrity Constraint Violation
  "23000": "Data integrity violation",
  "23001": "Restriction violation",
  "23502": "Required field cannot be empty",
  "23503": "Cannot delete: this record is referenced by other data",
  "23505": "A record with this value already exists",
  "23514": "Value does not meet requirements",

  // Class 22 - Data Exception
  "22000": "Invalid data format",
  "22001": "Value is too long for this field",
  "22003": "Number out of range",
  "22007": "Invalid date/time format",
  "22012": "Cannot divide by zero",
  "22P02": "Invalid number format",

  // Class 42 - Syntax/Access Error
  "42501": "You don't have permission to perform this action",
  "42601": "Invalid query syntax",
  "42703": "Unknown field",
  "42P01": "Table not found",

  // Class 40 - Transaction Rollback
  "40001": "Transaction conflict. Please try again.",
  "40P01": "Deadlock detected. Please try again.",

  // Class 53 - Insufficient Resources
  "53000": "Server resources temporarily unavailable",
  "53100": "Disk full",
  "53200": "Out of memory",
};

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
};

// =============================================================================
// Error Parsing Utilities
// =============================================================================

/**
 * Parse a PostgreSQL/Postgrest error into a user-friendly message.
 */
export function parsePostgresError(error: PostgrestError): string {
  // Check for specific constraint violation
  if (error.code === "23505" && error.message) {
    // Extract constraint name from message if available
    const match = error.message.match(/constraint "(\w+)"/);
    if (match && CONSTRAINT_MESSAGES[match[1]]) {
      return CONSTRAINT_MESSAGES[match[1]];
    }
    return "A record with this value already exists";
  }

  // Check for foreign key violation
  if (error.code === "23503" && error.message) {
    const match = error.message.match(/constraint "(\w+)"/);
    if (match && CONSTRAINT_MESSAGES[match[1]]) {
      return CONSTRAINT_MESSAGES[match[1]];
    }
    return "Cannot delete: this record is referenced by other data";
  }

  // Check for check constraint violation
  if (error.code === "23514" && error.message) {
    const match = error.message.match(/constraint "(\w+)"/);
    if (match && CONSTRAINT_MESSAGES[match[1]]) {
      return CONSTRAINT_MESSAGES[match[1]];
    }
    return "Value does not meet requirements";
  }

  // Use standard message mapping
  if (error.code && PG_ERROR_MESSAGES[error.code]) {
    return PG_ERROR_MESSAGES[error.code];
  }

  // Check for RLS/permission issues
  if (error.message?.includes("row-level security") || error.code === "42501") {
    return "You don't have permission to perform this action";
  }

  // Fallback to original message (cleaned up)
  return error.message || "An unexpected error occurred";
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
  return error.code === "23505";
}

/**
 * Check if a Postgrest error indicates a foreign key violation.
 */
export function isForeignKeyViolation(error: PostgrestError): boolean {
  return error.code === "23503";
}

/**
 * Check if a Postgrest error indicates a check constraint violation.
 */
export function isCheckViolation(error: PostgrestError): boolean {
  return error.code === "23514";
}
