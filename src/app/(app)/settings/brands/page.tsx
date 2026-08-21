/**
 * Brands List Page (server)
 *
 * Sitewide loading pattern (docs/plans/2026-07-15-sitewide-loading-pattern.md):
 * prefetches the initial paged list on the server with the SAME key the client
 * uses on first render, dehydrates it, and hydrates <BrandsClient/>. Only this
 * route's loading.tsx skeleton shows — never a second client skeleton.
 *
 * First relation-column list on the pattern. The server resolves the `style_id`
 * relation from brandCore.listRelations (the presentation listColumns are a
 * client module). The brands list renders custom cells (abv/is_active/status),
 * so the client's buildSelectList returns "*"; we pass `select: "*"` to match.
 */

import { createClient } from "@/lib/supabase/server";
import { getServerQueryClient, HydrateQuery } from "@/lib/query/prefetch";
import {
  listQueryOptions,
  defaultListParams,
} from "@/components/universal/list-query-options";
import { brandCore } from "@/entities/brand/core";
import { BrandsClient } from "./brands-client";

export default async function BrandsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const queryClient = getServerQueryClient();

  // The prefetch key only matches the client's DEFAULT view — skip it when
  // the URL carries explicit `?filters=`/`?sort=` rather than block TTFB on a
  // query the client would discard (key mismatch).
  if (params.filters === undefined && params.sort === undefined) {
    const supabase = await createClient();
    await queryClient.prefetchQuery(
      listQueryOptions(
        supabase,
        brandCore,
        defaultListParams(brandCore, { select: "*" })
      )
    );
  }

  return (
    <HydrateQuery client={queryClient}>
      <BrandsClient />
    </HydrateQuery>
  );
}
