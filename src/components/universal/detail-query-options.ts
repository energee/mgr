/**
 * Shared detail query-options factory for the sitewide loading pattern
 * (see docs/plans/2026-07-15-sitewide-loading-pattern.md).
 *
 * The single-record detail query and its React Query key are built here so BOTH
 * consume one source of truth:
 * - the client `useEntityRecord` hook (EntityDetailUnified's first render), and
 * - a server component's `prefetchQuery` (the initial detail render), which
 *   must produce the EXACT same key so the client hydrates without a second
 *   skeleton or a key mismatch.
 *
 * No "use client": this module runs on the server during prefetch. It needs
 * only the entity's `table`/`viewTable` (both live in the server-safe `*Core`),
 * plus whatever Supabase client the caller passes in — so a Server Component
 * can prefetch a detail page from the core alone, without importing the
 * assembled (client) entity config.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { entityKeys } from "@/lib/query-keys";
import { unwrap } from "@/lib/supabase/query-helpers";
import { dynamicFrom } from "@/services/types";

/** The slice of an entity the detail query reads. A full `EntityConfig` fits. */
export type DetailQueryEntity = { table: string; viewTable?: string };

/** Table/view the detail record is fetched from (view wins when defined). */
export function detailFetchTable(entity: DetailQueryEntity): string {
  return entity.viewTable || entity.table;
}

/**
 * React Query options ({ queryKey, queryFn }) for a single-record detail query
 * — the factory both `useEntityRecord` and a server `prefetchQuery` consume.
 * Selects `*` so the cached payload satisfies every consumer sharing this key
 * (narrowing here would corrupt full-row reads in EntityDetailUnified).
 */
export function detailQueryOptions<T = Record<string, unknown>>(
  supabase: SupabaseClient,
  entity: DetailQueryEntity,
  id: string,
) {
  const fetchTable = detailFetchTable(entity);
  return {
    queryKey: entityKeys.detail(fetchTable, id),
    queryFn: () =>
      unwrap(
        dynamicFrom(supabase, fetchTable).select("*").eq("id", id).single(),
      ) as Promise<T>,
  };
}
