/**
 * API Error Handling
 *
 * Custom error class and error mapping utilities for API route handlers.
 */

import { PG_ERROR_CODES } from "../pg-error-codes";

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

/**
 * Custom API error with structured code, status, and optional details.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: ApiErrorCode,
    message: string,
    status?: number,
    details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status ?? defaultStatusForCode(code);
    this.details = details;
  }
}

function defaultStatusForCode(code: ApiErrorCode): number {
  switch (code) {
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "VALIDATION_ERROR":
      return 422;
    case "CONFLICT":
      return 409;
    case "RATE_LIMITED":
      return 429;
    case "INTERNAL_ERROR":
      return 500;
  }
}

/**
 * PostgreSQL error code to friendly API error mapping.
 *
 * Error codes are sourced from the shared PG_ERROR_CODES constants.
 * Messages here are API-specific (may differ from client-side messages).
 */
const PG_ERROR_MAP: Record<
  string,
  { code: ApiErrorCode; status: number; message: string }
> = {
  [PG_ERROR_CODES.UNIQUE_VIOLATION]: {
    code: "CONFLICT",
    status: 409,
    message: "A record with this value already exists",
  },
  [PG_ERROR_CODES.FOREIGN_KEY_VIOLATION]: {
    code: "CONFLICT",
    status: 409,
    message: "This record is referenced by other data and cannot be modified",
  },
  [PG_ERROR_CODES.NOT_NULL_VIOLATION]: {
    code: "VALIDATION_ERROR",
    status: 422,
    message: "A required field is missing",
  },
  [PG_ERROR_CODES.CHECK_VIOLATION]: {
    code: "VALIDATION_ERROR",
    status: 422,
    message: "A field value violates a constraint",
  },
  [PG_ERROR_CODES.INSUFFICIENT_PRIVILEGE]: {
    code: "FORBIDDEN",
    status: 403,
    message: "Insufficient permissions for this operation",
  },
};

/**
 * Catch-all error handler that maps known error types to structured API errors.
 * Returns an ApiError suitable for building an error response.
 */
export function handleApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (isPostgresError(error)) {
    const mapped = PG_ERROR_MAP[error.code];
    if (mapped) {
      return new ApiError(mapped.code, mapped.message, mapped.status, {
        pg_code: error.code,
      });
    }
  }

  if (error instanceof Error) {
    return new ApiError("INTERNAL_ERROR", error.message, 500);
  }

  return new ApiError("INTERNAL_ERROR", "An unexpected error occurred", 500);
}

function isPostgresError(
  error: unknown
): error is { code: string; message: string; details?: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as Record<string, unknown>).code === "string"
  );
}
