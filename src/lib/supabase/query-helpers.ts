/**
 * Helpers for working with Supabase query/RPC results.
 *
 * `unwrap` replaces the `const { data, error } = await …; if (error) throw error;
 * return data;` pattern that is currently repeated ~228× across the codebase
 * (hooks, page components, API routes). Throwing on error lets React Query and
 * route error boundaries handle failures uniformly.
 *
 * This file is the foundation for the Phase 1 rollout described in
 * docs/superpowers/specs/2026-05-19-mgr-simplification-and-multi-org-design.md.
 * It is currently consumed by src/hooks/use-catalog.ts as a proof of concept;
 * the broad rollout is intentionally deferred to a reviewed change.
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
