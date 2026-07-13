/**
 * Helpers for working with Supabase query/RPC results.
 *
 * `unwrap` replaces the `const { data, error } = await …; if (error) throw error;
 * return data;` pattern that is currently repeated ~228× across the codebase
 * (hooks, page components, API routes). Throwing on error lets React Query and
 * route error boundaries handle failures uniformly.
 *
 * `escapeIlikePattern` turns a raw value into an exact-match `.ilike()` pattern
 * so PostgREST comparisons can be case-insensitive without wildcard surprises.
 */

import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Escapes a raw value for use as an EXACT (case-insensitive) match pattern
 * with PostgREST's `ilike` filter: `.ilike(column, escapeIlikePattern(value))`
 * is the app-side equivalent of SQL `lower(column) = lower(value)` (the idiom
 * migration 00201 uses for customer-email role assignment).
 *
 * Escaped characters:
 * - `\`, `%`, `_` — SQL LIKE metacharacters (backslash is the default escape).
 * - `*` — PostgREST translates `*` to `%` server-side and provides no escape
 *   syntax for it; pre-escaping yields a literal-`%` pattern, so values
 *   containing `*` fail CLOSED (no match) instead of wildcard-matching.
 *
 * Do not use the returned pattern for substring/prefix searches — it matches
 * the whole value only.
 */
export function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_*]/g, (ch) => `\\${ch}`);
}

/**
 * Awaits a Supabase query or RPC builder and returns its `data`, throwing the
 * `PostgrestError` if the query failed.
 *
 * The parameter is typed as `PromiseLike` because Supabase query builders are
 * thenable but not real Promises.
 *
 * @example
 *   const brands = await unwrap(
 *     supabase.from("brands").select("id, name").order("name"),
 *   );
 */
export async function unwrap<T>(
  builder: PromiseLike<{ data: T | null; error: PostgrestError | null }>,
): Promise<T> {
  const { data, error } = await builder;
  if (error) throw error;
  return data as T;
}
