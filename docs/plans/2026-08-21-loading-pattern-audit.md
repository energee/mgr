# Loading-pattern & skeleton bloat audit — 2026-08-21

User-reported symptoms: `/dashboard` shows a skeleton that doesn't match the page's
structure; `/production/batches` shows a skeleton that is roughly the right shape but
far too short. General ask: audit for bloat / unnecessary patterns in loading UI.

## TL;DR

The 2026-07-15 sitewide loading plan
([`2026-07-15-sitewide-loading-pattern.md`](2026-07-15-sitewide-loading-pattern.md))
stalled at Phase 0. Result: **seven disagreeing skeleton implementations** coexist,
3 of 132 app pages adopted server prefetch, 161 bespoke `<Skeleton>` blocks across 65
files remain (the plan counted ~207/66 — barely moved), and the two flagship pages
each stack multiple mismatched loading states in sequence. The jank is not one bug;
it is the half-finished migration itself.

## The seven skeleton systems

| # | Where | Shape | Used by |
|---|-------|-------|---------|
| 1 | `src/app/(app)/loading.tsx` | toolbar + h-10 bar + **8 × h-12 rows** (bespoke — does NOT use the kit) | every route without its own `loading.tsx` (≈128 of 132) |
| 2 | `ui/skeletons.tsx` `ListSkeleton` | toolbar + bordered **8 × h-4 cell rows** | 1 route (`settings/brands`) |
| 3 | `ui/skeletons.tsx` `DetailSkeleton` | header + **3 bordered sections × 4 fields** | 1 route (`production/batches/[id]`) |
| 4 | `entity-data-table.tsx` private `LoadingSkeleton` | **5 × h-4 table rows**, no toolbar/tabs/pagination | every `EntityList` page's client fetch |
| 5 | `entity-detail-unified.tsx` private `EntityDetailSkeleton` | breadcrumb + **1 card × 6 fields** | every non-prefetched detail page |
| 6 | `entity-relation-table.tsx` inline | **3 × h-12** | relation tables on detail pages |
| 7 | ~161 inline `<Skeleton>` blocks in 65 page/component files | all different | dashboards, reports, portal, dialogs |

Any cold navigation can chain 2–3 of these with different heights and shapes.
That chain — not any single skeleton — is the jank.

## Why `/dashboard` looks wrong

1. No `dashboard/loading.tsx` → the **generic table skeleton** (#1: toolbar + 8 rows)
   renders during segment streaming. The dashboard is a card grid with charts; the
   fallback is shaped like a list page. This is the mismatch you're seeing.
2. The page then mounts and swaps to a completely different layout with **four
   independently resolving skeleton regions** (active batches 5×h-9, vessels
   h-10+3×h-7, trend cards 3×h-[88px], chart boxes 2×h-[248px]) that pop in at
   different times. The chart-box skeleton is h-[248px] but the real chart renders
   h-[200px] inside a `DashboardSection` header — another height jump.
3. `GettingStartedChecklist` **returns `null` while loading** and then inserts itself
   at the top of the page, pushing the entire dashboard down after first paint
   (`getting-started-checklist.tsx:62`).

## Why `/production/batches` looks wrong

1. `production/batches/loading.tsx` **returns `null`** — a documented "temporary"
   double-skeleton fix that the Phase 0 plan explicitly said to revert to
   `ListSkeleton` and never did. So navigation shows a **blank content area** during
   the server prefetch.
2. The server prefetches the **unfiltered** first page
   (`defaultListParams` → `urlFilters: []`), but `batchEntity` has a default quick
   filter ("Active", `presentation.tsx:104`) that a client `useEffect` applies
   **after mount** (`entity-data-table.tsx:626`). The key changes, the prefetched
   payload is discarded, and the table refetches: **blank → unfiltered rows (tab
   briefly on "All") → 60 %-opacity dim + spinner → filtered rows.** The prefetch is
   wasted work on every default visit.
3. When the table's own skeleton does appear (cold client fetch — e.g. filtered or
   bookmarked URLs), it is the private 5-row `LoadingSkeleton` (~260 px) standing in
   for a 10-row table plus tabs, toolbar and pagination (~600 px+), with none of
   those chrome rows represented. That is the "right shape, too short" symptom.

## Findings (ranked, ponytail tags)

1. `delete:` the private `LoadingSkeleton` in `entity-data-table.tsx:1442` and
   `EntityDetailSkeleton` in `entity-detail-unified.tsx:2092` and the inline 3×h-12
   block in `entity-relation-table.tsx:148`. Replacement: kit `ListSkeleton` /
   `DetailSkeleton` with `rows` ≈ page size and `toolbar` matching the real chrome.
   One source of truth ends the shape mismatch at its most-used site.
2. `delete:` the bespoke block in `src/app/(app)/loading.tsx`. Replacement: render
   kit `ListSkeleton` (or a deliberately neutral centered shimmer) so the app-level
   fallback stops impersonating a list page under dashboards/reports.
3. `delete:` `production/batches/loading.tsx` `return null`. Replacement:
   `<ListSkeleton />` — exactly what the Phase 0 plan already prescribes.
4. `yagni:` `settings/brands/loading.tsx` is `"use client"` and imports the whole
   assembled `brandEntity` (presentation JSX + deps) into the loading chunk **just to
   count columns for gray boxes**. Replacement: server component with
   `columns={5}` hardcoded.
5. `shrink:` prefetch the key the client will actually keep — include the default
   quick filter in `defaultListParams` and derive the initial filter state instead of
   applying it in a post-mount `useEffect` (`entity-data-table.tsx:626`). Kills the
   unfiltered flash AND makes the batches prefetch useful instead of discarded.
6. `shrink:` `GettingStartedChecklist` loading state: reserve its space (or render it
   last/below) instead of `return null` → pop-in.
7. `yagni:` staggered `animationDelay` re-implemented at 3 sites with different
   values (75 ms / 60 ms / 75 ms). Fold into `Skeleton` itself or drop.
8. `delete:` (follow-up, the real payoff) the ~161 inline `<Skeleton>` blocks across
   65 files — the plan's Phase 4 that never ran. Mechanical once 1–3 land.

Net if 1–7 land: ≈ −120 lines immediately, one skeleton vocabulary, and both
reported pages fixed. Item 8 is the long tail (−1k+ lines over time).

## Recommendation

Do **not** resume the full server-prefetch rollout (Phases 1–3) as a prerequisite —
after a month it covers 3 pages and its flagship page throws away its own prefetch.
The cheap, high-leverage sequence is: unify the skeleton implementations onto the
existing kit (items 1–4, one small PR), then fix the two behavioral janks (5–6).
Server prefetch remains a per-page opt-in where it demonstrably helps (batch detail
is genuinely good today).
