/**
 * Shared PostgreSQL Error Code Constants
 *
 * Single source of truth for PG error codes and how each layer presents them:
 * one `PG_ERROR_TABLE` maps code → { message, api?, serviceCode? }, and thin
 * adapters consume it — client-side parsing (errors.ts) reads `message`, API
 * route handling (api/errors.ts) reads `api`, and the service layer
 * (services/types.ts) reads `serviceCode`.
 *
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */

import type { ApiErrorCode } from "./api/errors";

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

  // Custom PostgREST status code (HTTP 409). Unlike 40001, PostgREST does not
  // retry this expected business conflict behind the caller's back.
  CONFLICT: "PT409",

  // Class 53 - Insufficient Resources
  INSUFFICIENT_RESOURCES: "53000",
  DISK_FULL: "53100",
  OUT_OF_MEMORY: "53200",
} as const;

export type PgErrorCode = (typeof PG_ERROR_CODES)[keyof typeof PG_ERROR_CODES];

/**
 * API-layer classification for a PG error. The HTTP status is derived from
 * `code` by the ApiError constructor (see DEFAULT_STATUS_BY_CODE).
 */
export type PgApiMapping = {
  code: ApiErrorCode;
  message: string;
};

/** Service-layer discriminant for a PG error (see ServiceError in services/types.ts). */
export type PgServiceCode = "FK_VIOLATION" | "UNIQUE_VIOLATION" | "RLS_DENIED";

export type PgErrorEntry = {
  /** Client-facing message (toasts, inline form errors). */
  message: string;
  /** API route mapping — only for codes API routes translate to structured errors. */
  api?: PgApiMapping;
  /** Service-layer error code — only for codes parseSupabaseError distinguishes. */
  serviceCode?: PgServiceCode;
};

/**
 * The unified code → presentation table. API messages are intentionally
 * allowed to differ from client messages where the audience differs.
 */
export const PG_ERROR_TABLE: Record<string, PgErrorEntry> = {
  // Class 23 - Integrity Constraint Violation
  [PG_ERROR_CODES.INTEGRITY_CONSTRAINT]: { message: "Data integrity violation" },
  [PG_ERROR_CODES.RESTRICT_VIOLATION]: { message: "Restriction violation" },
  [PG_ERROR_CODES.NOT_NULL_VIOLATION]: {
    message: "Required field cannot be empty",
    api: {
      code: "VALIDATION_ERROR",
      message: "A required field is missing",
    },
  },
  [PG_ERROR_CODES.FOREIGN_KEY_VIOLATION]: {
    message: "Cannot delete: this record is referenced by other data",
    api: {
      code: "CONFLICT",
      message: "This record is referenced by other data and cannot be modified",
    },
    serviceCode: "FK_VIOLATION",
  },
  [PG_ERROR_CODES.UNIQUE_VIOLATION]: {
    message: "A record with this value already exists",
    api: {
      code: "CONFLICT",
      message: "A record with this value already exists",
    },
    serviceCode: "UNIQUE_VIOLATION",
  },
  [PG_ERROR_CODES.CHECK_VIOLATION]: {
    message: "Value does not meet requirements",
    api: {
      code: "VALIDATION_ERROR",
      message: "A field value violates a constraint",
    },
  },

  // Class 22 - Data Exception
  [PG_ERROR_CODES.DATA_EXCEPTION]: { message: "Invalid data format" },
  [PG_ERROR_CODES.STRING_DATA_RIGHT_TRUNCATION]: {
    message: "Value is too long for this field",
  },
  [PG_ERROR_CODES.NUMERIC_VALUE_OUT_OF_RANGE]: { message: "Number out of range" },
  [PG_ERROR_CODES.INVALID_DATETIME_FORMAT]: { message: "Invalid date/time format" },
  [PG_ERROR_CODES.DIVISION_BY_ZERO]: { message: "Cannot divide by zero" },
  [PG_ERROR_CODES.INVALID_TEXT_REPRESENTATION]: { message: "Invalid number format" },

  // Class 42 - Syntax/Access Error
  [PG_ERROR_CODES.INSUFFICIENT_PRIVILEGE]: {
    message: "You don't have permission to perform this action",
    api: {
      code: "FORBIDDEN",
      message: "Insufficient permissions for this operation",
    },
    serviceCode: "RLS_DENIED",
  },
  [PG_ERROR_CODES.SYNTAX_ERROR]: { message: "Invalid query syntax" },
  [PG_ERROR_CODES.UNDEFINED_COLUMN]: { message: "Unknown field" },
  [PG_ERROR_CODES.UNDEFINED_TABLE]: { message: "Table not found" },

  // Class 40 - Transaction Rollback
  [PG_ERROR_CODES.SERIALIZATION_FAILURE]: {
    message: "Transaction conflict. Please try again.",
  },
  [PG_ERROR_CODES.DEADLOCK_DETECTED]: {
    message: "Deadlock detected. Please try again.",
  },

  // Class 53 - Insufficient Resources
  [PG_ERROR_CODES.INSUFFICIENT_RESOURCES]: {
    message: "Server resources temporarily unavailable",
  },
  [PG_ERROR_CODES.DISK_FULL]: { message: "Disk full" },
  [PG_ERROR_CODES.OUT_OF_MEMORY]: { message: "Out of memory" },
};
