/**
 * Batches List Page (server)
 *
 * Reference implementation of the sitewide loading pattern
 * (docs/plans/2026-07-15-sitewide-loading-pattern.md): a server component
 * prefetches the initial paged list query with the SAME key the client uses on
 * first render, dehydrates it, and hydrates <BatchesClient/>. The client mounts
 * with data already in cache, so only this route's loading.tsx skeleton shows —
 * never a second client skeleton. Interactive refinements (filter/sort/search/
 * pagination) refetch on the client as before.
 */

import { createClient } from "@/lib/supabase/server";
import { getServerQueryClient, HydrateQuery } from "@/lib/query/prefetch";
import {
  listQueryOptions,
  defaultListParams,
} from "@/components/universal/list-query-options";
// Import the server-safe CORE (not the assembled batchEntity, which is a client
// module — presentation.tsx renders JSX). The core carries everything the
// prefetch needs (table/viewTable/defaultSort); batch list columns have no
// relation, so no FK-resolution metadata is lost. See ListQueryEntity.
import { batchCore } from "@/entities/batch/core";
import { BatchesClient } from "./batches-client";

export default async function BatchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const queryClient = getServerQueryClient();

  // batches-client passes `onAction`, forcing a `*` projection (hasOnAction) —
  // must match the client's first-render key exactly, which includes the
  // default "Active" quick filter (defaultListParams applies it from
  // batchCore.quickFilters). That key only matches on the DEFAULT view, so a
  // URL carrying explicit `?filters=`/`?sort=` (e.g. the All tab's
  // `?filters=[]`) skips the prefetch instead of blocking TTFB on a query the
  // client would discard. prefetchQuery never rejects, so an auth/RLS miss
  // just leaves the client to fetch normally.
  if (params.filters === undefined && params.sort === undefined) {
    const supabase = await createClient();
    await queryClient.prefetchQuery(
      listQueryOptions(
        supabase,
        batchCore,
        defaultListParams(batchCore, { hasOnAction: true })
      )
    );
  }

  return (
    <HydrateQuery client={queryClient}>
      <BatchesClient />
    </HydrateQuery>
  );
}
