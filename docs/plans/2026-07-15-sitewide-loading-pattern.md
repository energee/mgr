# Sitewide loading pattern — server prefetch + hydration

## Problem

Loading UI is owned in two places, so client data pages flash **two skeletons**:

1. **Route boundary** — `src/app/(app)/loading.tsx` renders during segment streaming.
2. **Client fetch** — each page's React Query `isLoading` renders its own skeleton after mount.

Scale of the mess (survey 2026-07-15):
- **131 of 139 pages are client components** — nearly every page fetches its own data client-side.
- **~207 bespoke skeleton blocks across 66 files** — no shared skeleton; each page reinvents one.

## Chosen approach — server prefetch / hydrate (single skeleton, best feel)

Pages prefetch their query on the server, dehydrate the cache, and hydrate the
client. The client component mounts with data already present (`isLoading` is
`false` on first render), so **only the route-level `loading.tsx` skeleton shows**
— during the server fetch — and never a second client skeleton.

```
navigate → loading.tsx skeleton (covers the server fetch) → hydrated page, no client skeleton
```

## The pieces (built once, used everywhere)

1. **Shared skeleton kit** — `src/components/ui/skeletons/` with `ListSkeleton`,
   `DetailSkeleton`, `FormSkeleton` (replace the ~207 bespoke blocks over time).
   Each route's `loading.tsx` renders the matching one.

2. **Server prefetch helper** — `src/lib/query/prefetch.ts`:
   - `getServerQueryClient()` — a per-request `QueryClient`.
   - `<HydrateQuery client={qc}>` wrapper around `HydrationBoundary` +
     `dehydrate(qc)`.
   Page pattern:
   ```tsx
   // page.tsx (server component)
   export default async function Page() {
     const qc = getServerQueryClient();
     await qc.prefetchQuery(listQueryOptions(entity, DEFAULT_LIST_PARAMS));
     return <HydrateQuery client={qc}><BatchesClient /></HydrateQuery>;
   }
   ```

3. **Shared query-options factory** — the crux. `entity-data-table` builds its
   `listQueryKey` + fetch internally; extract a `listQueryOptions(entity, params)`
   used by BOTH the server prefetch and the client `useQuery`. The **initial**
   params (no filters, default sort, page 0, persisted page size) must be
   reproducible on the server so the hydrated key hits exactly. Client-only
   refinements (debounced search, filter changes) refetch normally — that's
   fine, they use `keepPreviousData` and never reflash.

4. **`loading.tsx` per section** renders the right shared skeleton (list vs
   detail). The app-level fallback stays as a generic default.

## Rollout (phased — own PR, not this branch)

- **Phase 0 — foundation + reference:** build the skeleton kit, `prefetch.ts`,
  extract `listQueryOptions`, and convert **one list page (batches)** + **one
  detail page** end-to-end as the copyable template. Revert the temporary
  `production/batches/loading.tsx` (returns `null`) to render `ListSkeleton`.
- **Phase 1 — list pages:** every EntityList route (orders, suppliers, batches,
  recipes, customers, …) — mechanical once the template exists.
- **Phase 2 — detail pages** (`EntityDetailUnified`).
- **Phase 3 — dashboards / bespoke pages.**
- **Phase 4 — delete the ~207 ad-hoc skeleton blocks** as pages adopt the kit.

## Notes / risks

- Hydration mismatch if the server-prefetched key ≠ the client's first key.
  Mitigation: single `listQueryOptions` factory + a fixed `DEFAULT_LIST_PARAMS`.
- Auth: prefetch uses the server Supabase client (RLS-scoped to the request user).
- The temporary batches `loading.tsx` (returns `null`, from the double-skeleton
  fix) is superseded by Phase 0.
- This is multi-session; each phase ships independently and is individually
  verifiable (no page shows two skeletons after its phase).
