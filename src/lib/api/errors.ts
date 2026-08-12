/**
 * API Error Handling
 *
 * Custom error class and error mapping utilities for API route handlers.
 */

import { PG_ERROR_TABLE } from "../pg-error-codes";

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
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

const DEFAULT_STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

function defaultStatusForCode(code: ApiErrorCode): number {
  return DEFAULT_STATUS_BY_CODE[code];
}

/**
 * Catch-all error handler that maps known error types to structured API errors.
 * Returns an ApiError suitable for building an error response.
 *
 * PG error code → API error mapping (code/status/API-specific message) lives
 * in the shared PG_ERROR_TABLE (`api` field) in ../pg-error-codes.
 */
export function handleApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (isPostgresError(error)) {
    const mapped = PG_ERROR_TABLE[error.code]?.api;
    if (mapped) {
      return new ApiError(mapped.code, mapped.message, undefined, {
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
