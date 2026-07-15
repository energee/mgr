/**
 * Server-side prefetch + hydration helpers for the sitewide loading pattern
 * (see docs/plans/2026-07-15-sitewide-loading-pattern.md).
 *
 * A page (server component) creates the per-request QueryClient, prefetches its
 * list/detail query with the SAME queryKey the client will use, then wraps the
 * client subtree in <HydrateQuery>. The client component mounts with the data
 * already in cache (`isLoading` false), so only the route-level loading.tsx
 * skeleton ever shows — never a second client skeleton.
 *
 * This is a lean server QueryClient: unlike createAppQueryClient it has no
 * MutationCache (that carries a client-only sonner toast) — prefetch only reads.
 */
import { cache } from "react";
import {
  QueryClient,
  HydrationBoundary,
  dehydrate,
} from "@tanstack/react-query";
import { CACHE_DURATIONS } from "@/lib/constants";

/**
 * Per-request server QueryClient. React `cache()` returns one instance per
 * request, so multiple prefetches in the same page accumulate into a single
 * dehydrated payload.
 */
export const getServerQueryClient = cache(
  () =>
    new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
          gcTime: 5 * 60 * 1000,
          retry: 1,
        },
      },
    })
);

/**
 * Dehydrates the server QueryClient and hands the state to a HydrationBoundary
 * so the wrapped client subtree hydrates with the prefetched queries.
 */
export function HydrateQuery({
  client,
  children,
}: {
  client: QueryClient;
  children: React.ReactNode;
}) {
  return (
    <HydrationBoundary state={dehydrate(client)}>{children}</HydrationBoundary>
  );
}
