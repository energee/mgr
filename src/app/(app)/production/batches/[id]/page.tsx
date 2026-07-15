/**
 * Batch Detail Page (server)
 *
 * Reference implementation of the sitewide loading pattern for DETAIL pages
 * (docs/plans/2026-07-15-sitewide-loading-pattern.md): a server component
 * prefetches the single-record detail query with the SAME key EntityDetailUnified
 * uses on first render (via useEntityRecord → detailQueryOptions), dehydrates it,
 * and hydrates <BatchDetailClient/>. The client's useEntityRecord mounts with the
 * record already in cache, so only this route's loading.tsx <DetailSkeleton/>
 * shows — never a second client skeleton.
 *
 * Imports the server-safe batchCore (not batchEntity, a client module) — the
 * detail query needs only table/viewTable, both of which live in the core.
 */

import { createClient } from "@/lib/supabase/server";
import { getServerQueryClient, HydrateQuery } from "@/lib/query/prefetch";
import { detailQueryOptions } from "@/components/universal/detail-query-options";
import { batchCore } from "@/entities/batch/core";
import { BatchDetailClient } from "./batch-detail-client";

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const queryClient = getServerQueryClient();

  // prefetchQuery never rejects, so an auth/RLS miss just leaves the client to
  // fetch normally (showing its own loading state) instead of erroring the page.
  await queryClient.prefetchQuery(detailQueryOptions(supabase, batchCore, id));

  return (
    <HydrateQuery client={queryClient}>
      <BatchDetailClient id={id} />
    </HydrateQuery>
  );
}
