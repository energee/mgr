/**
 * Service Layer Types
 *
 * Foundation types for the shared data access layer. Both UI components
 * and AI chat tools consume services through these types, ensuring
 * consistent error handling, validation, and cache invalidation.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import type { ZodIssue } from "zod";

// =============================================================================
// Database Type Aliases
// =============================================================================

/** Valid base table name from the generated Supabase schema. */
export type TableName = keyof Database["public"]["Tables"];

/** Valid view name from the generated Supabase schema. */
export type ViewName = keyof Database["public"]["Views"];

/** Either a base table or a view — used for entity configs with `viewTable`. */
export type TableOrViewName = TableName | ViewName;

/** Row type for a given table name. */
export type TableRow<T extends TableName> = Database["public"]["Tables"][T]["Row"];

/** Insert type for a given table name. */
export type TableInsert<T extends TableName> = Database["public"]["Tables"][T]["Insert"];

/** Update type for a given table name. */
export type TableUpdate<T extends TableName> = Database["public"]["Tables"][T]["Update"];

// =============================================================================
// Service Result
// =============================================================================

/**
 * Discriminated union for service method results.
 *
 * On success, includes the data and a list of query key arrays to invalidate.
 * On failure, includes a typed error describing what went wrong.
 */
export type ServiceResult<T> =
  | { success: true; data: T; invalidate: readonly (readonly string[])[] }
  | { success: false; error: ServiceError };

// =============================================================================
// Service Errors
// =============================================================================

/**
 * Typed error union covering all expected failure modes.
 *
 * Each variant includes a `code` discriminant and enough context for UI
 * components to render appropriate error messages (toast, inline, etc.).
 */
export type ServiceError =
  | { code: "VALIDATION"; issues: ZodIssue[] }
  | { code: "CONFLICT"; currentVersion: number; message: string }
  | { code: "UNIQUE_VIOLATION"; message: string }
  | { code: "NOT_FOUND"; table: string; id: string }
  | { code: "FK_VIOLATION"; message: string }
  | { code: "RLS_DENIED"; message: string }
  | { code: "INVALID_TRANSITION"; from: string; to: string; message: string }
  | { code: "UNKNOWN"; message: string; cause?: unknown };

// =============================================================================
// Service List Options
// =============================================================================

/** Options for listing entity records. */
export interface ListOptions {
  /** Column-value filters to apply (exact match). */
  filters?: Record<string, unknown>;
  /** Free-text search across entity's searchableFields. */
  search?: string;
  /** Sort configuration. */
  sort?: { column: string; direction: "asc" | "desc" };
  /** Maximum number of records to return. */
  limit?: number;
}

// =============================================================================
// Helpers
// =============================================================================

/** Create a successful result with data and invalidation hints. */
export function ok<T>(data: T, invalidate: readonly (readonly string[])[] = []): ServiceResult<T> {
  return { success: true, data, invalidate };
}

/** Create a failed result from a ServiceError. */
export function err<T>(error: ServiceError): ServiceResult<T> {
  return { success: false, error };
}

/**
 * Parse a Supabase/PostgREST error into a typed ServiceError.
 *
 * Maps common PostgreSQL error codes to specific ServiceError variants:
 * - 23503 (FK violation) → FK_VIOLATION
 * - 23505 (unique constraint) → UNIQUE_VIOLATION
 * - 42501 (insufficient privilege) → RLS_DENIED
 * - PGRST116 (no rows) → NOT_FOUND
 * - Everything else → UNKNOWN
 */
export function parseSupabaseError(
  error: { code?: string; message: string; details?: string },
  context?: { table?: string; id?: string }
): ServiceError {
  const message = error.message;

  // Foreign key violation
  if (error.code === "23503") {
    return { code: "FK_VIOLATION", message };
  }

  // RLS / insufficient privilege
  if (error.code === "42501") {
    return { code: "RLS_DENIED", message };
  }

  // No rows returned (PostgREST .single() with no match)
  if (error.code === "PGRST116") {
    return {
      code: "NOT_FOUND",
      table: context?.table ?? "unknown",
      id: context?.id ?? "unknown",
    };
  }

  // Unique constraint violation (e.g., duplicate name, number, or key)
  if (error.code === "23505") {
    return { code: "UNIQUE_VIOLATION", message };
  }

  return { code: "UNKNOWN", message, cause: error };
}

// =============================================================================
// Dynamic Query Helpers
// =============================================================================

/**
 * Untyped Supabase query builder for tables/views accessed by dynamic name.
 * Used when the table name comes from entity config at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DynamicQueryBuilder = any;

/**
 * Access a Supabase table by dynamic name. Centralizes the type assertion
 * needed when table names come from entity config at runtime.
 */
export function dynamicFrom(supabase: SupabaseClient<Database>, table: string): DynamicQueryBuilder {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase.from(table as any);
}

/**
 * Call a Supabase RPC function by dynamic name. Centralizes the type assertion
 * needed when function names are determined at runtime.
 * Returns an untyped promise since the function name is not known at compile time.
 */
export function dynamicRpc(supabase: SupabaseClient<Database>, fn: string, args?: Record<string, unknown>): DynamicQueryBuilder {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase.rpc(fn as any, args as any);
}

/**
 * Get a human-readable error message from a ServiceError.
 */
export function formatServiceError(error: ServiceError): string {
  switch (error.code) {
    case "VALIDATION":
      return `Validation failed: ${error.issues.map((i) => i.message).join(", ")}`;
    case "CONFLICT":
      return error.message;
    case "UNIQUE_VIOLATION":
      return `A record with that value already exists`;
    case "NOT_FOUND":
      return `Record not found in ${error.table}`;
    case "FK_VIOLATION":
      return `Cannot complete: a related record constraint was violated`;
    case "RLS_DENIED":
      return `You don't have permission to perform this action`;
    case "INVALID_TRANSITION":
      return error.message;
    case "UNKNOWN":
      return error.message;
  }
}
