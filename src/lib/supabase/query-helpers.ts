/**
 * Helpers for working with Supabase query/RPC results.
 *
 * `unwrap` replaces the `const { data, error } = await …; if (error) throw error;
 * return data;` pattern that is currently repeated ~228× across the codebase
 * (hooks, page components, API routes). Throwing on error lets React Query and
 * route error boundaries handle failures uniformly.
 */

import type { PostgrestError } from "@supabase/supabase-js";

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
