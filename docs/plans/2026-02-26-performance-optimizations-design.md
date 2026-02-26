# Performance Optimizations Design

**Date:** 2026-02-26
**Branch:** worktree-optimizations
**Status:** Approved

## Goal

Sweeping, low-risk performance optimizations that benefit the entire site without regressions. Focused on bundle size reduction, rendering efficiency, and data fetching.

## Sections

### 1. Lazy-Load Chat Panel (Bundle Size)

**Problem:** The chat stack (shiki ~1.2MB, streamdown + mermaid ~500KB, AI element components) is eagerly loaded in the root layout on every authenticated page, even when chat is closed.

**Solution:**
- `chat-layout.tsx` — `next/dynamic` import for `ChatPanel` with `ssr: false`
- `ChatProvider` stays in `app-providers.tsx` (lightweight — just `useChat` + context)
- `ChatToggle` stays static (tiny button)

**Files:** `src/components/domain/chat-layout.tsx`

**Impact:** ~2-3MB deferred from initial bundle on every page.

### 2. `next.config.ts` — Enable `optimizePackageImports`

**Problem:** Config is empty. Heavy barrel-exported libraries (lucide-react, recharts, date-fns, motion) aren't getting optimal tree-shaking.

**Solution:**
```typescript
const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "date-fns",
      "@radix-ui/react-icons",
      "motion",
    ],
  },
};
```

**Files:** `next.config.ts`

**Impact:** 5-15% bundle reduction for pages importing these libraries.

### 3. React Query Cache Tuning

**Problem:** Dashboard queries poll at 30-60s intervals without `staleTime`, generating ~13 queries/minute. Global `staleTime` of 60s is too short for catalog/static data.

**Solution:**
- Global defaults in `providers.tsx`: bump `staleTime` from 60s → 120s
- Dashboard polling — relaxed cadence:
  - Core production (batchCounts, activeBatches, orderCounts, recentOrders): 60s (was 30s)
  - Secondary data (vessels, shortfalls, customerRevenue, productMix, lowStock, expiringLots, inventorySummary): 120s (was 30-60s)
- Add `staleTime` to dashboard queries alongside `refetchInterval`
- Use `CACHE_DURATIONS` constants consistently

**Files:** `src/lib/providers.tsx`, `src/app/(app)/dashboard/page.tsx`, `src/app/(app)/dashboard/sales/page.tsx`, `src/app/(app)/dashboard/inventory/page.tsx`

**Impact:** Queries from ~13/min → ~5/min.

### 4. Memoization Fixes (Rendering Performance)

**Problem:** `useDynamicFilterOptions` returns an unstable object reference on every fetch → cascades to column regeneration in `entity-data-table.tsx` → every table cell re-renders. Inline `cell` functions in `buildDataTableColumns()` break TanStack Table row memoization.

**Solution:**
1. `use-dynamic-filter-options.ts` — Deep-compare before `setDynamicFilterOptions` to avoid unnecessary state updates when data hasn't changed.
2. `data-table-adapter.tsx` — Extract cell rendering to a stable `CellRenderer` component wrapped in `React.memo()`.

**Files:** `src/hooks/use-dynamic-filter-options.ts`, `src/lib/data-table-adapter.tsx`

**Impact:** Every entity list page benefits from fewer re-renders.

### 5. Chat API Tool — Use Pre-Aggregated View

**Problem:** `getBatchStatus` tool fetches all batch rows and counts in JavaScript. The `batch_status_counts` view already exists.

**Solution:** Replace `from("batches").select("status")` with `from("batch_status_counts").select("*")`.

**Files:** `src/app/api/chat/tools.ts`

**Impact:** Single pre-aggregated query instead of full table scan + JS aggregation.

### 6. Loading Boundaries

**Problem:** No `loading.tsx` or `error.tsx` boundaries exist anywhere. No Suspense streaming, no graceful error recovery.

**Solution:**
- Add `src/app/(app)/loading.tsx` — skeleton for app shell
- Add `src/app/(app)/error.tsx` — error boundary with reset button

**Files:** New files only.

**Impact:** Better perceived performance, graceful error handling.

## Out of Scope

- Converting pages from `"use client"` to server components (high effort, regression risk)
- Entity registry code splitting (configs are small)
- ISR/revalidation (data is user-scoped behind RLS)
- Middleware/proxy changes (already has proper static asset matcher)
