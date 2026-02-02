/**
 * Shared PostgreSQL Error Code Constants
 *
 * Single source of truth for PG error codes and their user-friendly messages.
 * Used by both client-side error parsing (errors.ts) and API error handling (api/errors.ts).
 *
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */

/**
 * Semantic names for commonly encountered PostgreSQL error codes.
 */
export const PG_ERROR_CODES = {
  // Class 23 - Integrity Constraint Violation
  INTEGRITY_CONSTRAINT: "23000",
  RESTRICT_VIOLATION: "23001",
  NOT_NULL_VIOLATION: "23502",
  FOREIGN_KEY_VIOLATION: "23503",
  UNIQUE_VIOLATION: "23505",
  CHECK_VIOLATION: "23514",

  // Class 22 - Data Exception
  DATA_EXCEPTION: "22000",
  STRING_DATA_RIGHT_TRUNCATION: "22001",
  NUMERIC_VALUE_OUT_OF_RANGE: "22003",
  INVALID_DATETIME_FORMAT: "22007",
  DIVISION_BY_ZERO: "22012",
  INVALID_TEXT_REPRESENTATION: "22P02",

  // Class 42 - Syntax/Access Error
  INSUFFICIENT_PRIVILEGE: "42501",
  SYNTAX_ERROR: "42601",
  UNDEFINED_COLUMN: "42703",
  UNDEFINED_TABLE: "42P01",

  // Class 40 - Transaction Rollback
  SERIALIZATION_FAILURE: "40001",
  DEADLOCK_DETECTED: "40P01",

  // Class 53 - Insufficient Resources
  INSUFFICIENT_RESOURCES: "53000",
  DISK_FULL: "53100",
  OUT_OF_MEMORY: "53200",
} as const;

export type PgErrorCode = (typeof PG_ERROR_CODES)[keyof typeof PG_ERROR_CODES];

/**
 * Map PostgreSQL error codes to user-friendly messages.
 */
export const PG_ERROR_MESSAGES: Record<string, string> = {
  // Class 23 - Integrity Constraint Violation
  [PG_ERROR_CODES.INTEGRITY_CONSTRAINT]: "Data integrity violation",
  [PG_ERROR_CODES.RESTRICT_VIOLATION]: "Restriction violation",
  [PG_ERROR_CODES.NOT_NULL_VIOLATION]: "Required field cannot be empty",
  [PG_ERROR_CODES.FOREIGN_KEY_VIOLATION]:
    "Cannot delete: this record is referenced by other data",
  [PG_ERROR_CODES.UNIQUE_VIOLATION]:
    "A record with this value already exists",
  [PG_ERROR_CODES.CHECK_VIOLATION]: "Value does not meet requirements",

  // Class 22 - Data Exception
  [PG_ERROR_CODES.DATA_EXCEPTION]: "Invalid data format",
  [PG_ERROR_CODES.STRING_DATA_RIGHT_TRUNCATION]:
    "Value is too long for this field",
  [PG_ERROR_CODES.NUMERIC_VALUE_OUT_OF_RANGE]: "Number out of range",
  [PG_ERROR_CODES.INVALID_DATETIME_FORMAT]: "Invalid date/time format",
  [PG_ERROR_CODES.DIVISION_BY_ZERO]: "Cannot divide by zero",
  [PG_ERROR_CODES.INVALID_TEXT_REPRESENTATION]: "Invalid number format",

  // Class 42 - Syntax/Access Error
  [PG_ERROR_CODES.INSUFFICIENT_PRIVILEGE]:
    "You don't have permission to perform this action",
  [PG_ERROR_CODES.SYNTAX_ERROR]: "Invalid query syntax",
  [PG_ERROR_CODES.UNDEFINED_COLUMN]: "Unknown field",
  [PG_ERROR_CODES.UNDEFINED_TABLE]: "Table not found",

  // Class 40 - Transaction Rollback
  [PG_ERROR_CODES.SERIALIZATION_FAILURE]:
    "Transaction conflict. Please try again.",
  [PG_ERROR_CODES.DEADLOCK_DETECTED]:
    "Deadlock detected. Please try again.",

  // Class 53 - Insufficient Resources
  [PG_ERROR_CODES.INSUFFICIENT_RESOURCES]:
    "Server resources temporarily unavailable",
  [PG_ERROR_CODES.DISK_FULL]: "Disk full",
  [PG_ERROR_CODES.OUT_OF_MEMORY]: "Out of memory",
};
