# Performance Optimizations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce initial bundle size by ~2-3MB, cut dashboard query load from ~13/min to ~5/min, and eliminate unnecessary table re-renders across all entity list pages.

**Architecture:** Six independent optimizations — lazy-load chat panel via `next/dynamic`, enable `optimizePackageImports` in Next.js config, tune React Query cache/polling, stabilize memoization in data table adapter and dynamic filter options hook, replace client-side aggregation with pre-built view in chat tools, and add loading/error boundaries.

**Tech Stack:** Next.js 16, React 19, TanStack Query v5, TanStack Table v8, Supabase

---

### Task 1: Lazy-Load Chat Panel

**Files:**
- Modify: `src/components/domain/chat-layout.tsx`

**Step 1: Replace static import with dynamic import**

Replace the entire contents of `src/components/domain/chat-layout.tsx` with:

```tsx
"use client";

import dynamic from "next/dynamic";
import { ChatToggle } from "@/components/domain/chat-toggle";

const ChatPanel = dynamic(
  () => import("@/components/domain/chat-panel").then((m) => m.ChatPanel),
  { ssr: false }
);

interface ChatLayoutProps {
  children: React.ReactNode;
  header: React.ReactNode;
}

export function ChatLayout({ children, header }: ChatLayoutProps) {
  return (
    <div className="flex-1 flex flex-col">
      {header}
      <div id="main-content" className="flex-1 p-4 md:p-6 overflow-y-auto">{children}</div>
      <ChatPanel />
      <ChatToggle />
    </div>
  );
}
```

**Step 2: Verify build passes**

Run: `pnpm typecheck`
Expected: 0 errors

**Step 3: Verify dev server works**

Run: `pnpm dev` — navigate to any authenticated page, confirm:
1. Page loads without chat panel JS in initial bundle
2. Click the Claude toggle button (bottom-right) — chat panel appears
3. Cmd+. keyboard shortcut still works (handled by ChatProvider, which is still eager)

**Step 4: Commit**

```bash
git add src/components/domain/chat-layout.tsx
git commit -m "perf: lazy-load ChatPanel via next/dynamic

Defers ~2-3MB of JS (shiki, streamdown, mermaid, AI elements)
from initial page load. ChatProvider stays eager so keyboard
shortcut (Cmd+.) works immediately."
```

---

### Task 2: Enable `optimizePackageImports` in Next.js Config

**Files:**
- Modify: `next.config.ts`

**Step 1: Add experimental config**

Replace the contents of `next.config.ts` with:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "date-fns",
      "motion",
    ],
  },
};

export default nextConfig;
```

Note: `@radix-ui/*` packages are already imported from specific subpackages (e.g., `@radix-ui/react-dialog`), so they don't benefit from this. Only include libraries that use barrel exports.

**Step 2: Verify build passes**

Run: `pnpm typecheck`
Expected: 0 errors

Run: `pnpm build`
Expected: Build completes successfully. May see reduced chunk sizes in output.

**Step 3: Commit**

```bash
git add next.config.ts
git commit -m "perf: enable optimizePackageImports for heavy barrel-exported libs

Adds build-time import optimization for lucide-react, recharts,
date-fns, and motion. Transforms barrel imports into direct module
imports for better tree-shaking."
```

---

### Task 3: React Query Cache Tuning — Global Defaults

**Files:**
- Modify: `src/lib/providers.tsx`

**Step 1: Update global QueryClient defaults**

In `src/lib/providers.tsx`, change the `staleTime` from `60 * 1000` to `2 * 60 * 1000`:

```typescript
staleTime: 2 * 60 * 1000,
```

This is a single-line change. The rest of the file stays identical.

**Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/lib/providers.tsx
git commit -m "perf: increase global React Query staleTime from 60s to 120s

Reduces redundant refetches across all queries. Individual queries
can still override with shorter staleTime where needed."
```

---

### Task 4: Dashboard Polling — Production Dashboard

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

**Step 1: Import CACHE_DURATIONS**

Add to the imports section:

```typescript
import { CACHE_DURATIONS } from "@/lib/constants";
```

**Step 2: Update all four useQuery calls**

For `batchCounts` query (line ~96):
```typescript
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
```

For `activeBatches` query (line ~127):
```typescript
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
```

For `vessels` query (line ~149):
```typescript
    refetchInterval: 120000,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
```

For `shortfalls` query (line ~166):
```typescript
    refetchInterval: 120000,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
```

Summary of changes:
- `batchCounts`: 30s → 60s
- `activeBatches`: 30s → 60s
- `vessels`: 30s → 120s
- `shortfalls`: 60s → 120s
- All get explicit `staleTime` to prevent redundant refetch on tab switch

**Step 3: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: 0 errors

**Step 4: Commit**

```bash
git add src/app/(app)/dashboard/page.tsx
git commit -m "perf: relax production dashboard polling intervals

batchCounts/activeBatches: 30s → 60s
vessels/shortfalls: 30-60s → 120s
Add explicit staleTime to all queries."
```

---

### Task 5: Dashboard Polling — Sales Dashboard

**Files:**
- Modify: `src/app/(app)/dashboard/sales/page.tsx`

**Step 1: Import CACHE_DURATIONS**

Add to the imports section:

```typescript
import { CACHE_DURATIONS } from "@/lib/constants";
```

**Step 2: Update all four useQuery calls**

For `orderCounts` query:
```typescript
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
```

For `recentOrders` query:
```typescript
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
```

For `customerRevenue` query:
```typescript
    refetchInterval: 120000,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
```

For `productMix` query:
```typescript
    refetchInterval: 120000,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
```

Summary:
- `orderCounts`: 30s → 60s
- `recentOrders`: 30s → 60s
- `customerRevenue`: 60s → 120s
- `productMix`: 60s → 120s

**Step 3: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: 0 errors

**Step 4: Commit**

```bash
git add src/app/(app)/dashboard/sales/page.tsx
git commit -m "perf: relax sales dashboard polling intervals

orderCounts/recentOrders: 30s → 60s
customerRevenue/productMix: 60s → 120s
Add explicit staleTime to all queries."
```

---

### Task 6: Dashboard Polling — Inventory Dashboard

**Files:**
- Modify: `src/app/(app)/dashboard/inventory/page.tsx`

**Step 1: Import CACHE_DURATIONS**

Add to the imports section:

```typescript
import { CACHE_DURATIONS } from "@/lib/constants";
```

**Step 2: Update all three useQuery calls**

For `lowStock` query:
```typescript
    refetchInterval: 120000,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
```

For `expiringLots` query:
```typescript
    refetchInterval: 120000,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
```

For `inventorySummary` query:
```typescript
    refetchInterval: 120000,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
```

All three: 60s → 120s

**Step 3: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: 0 errors

**Step 4: Commit**

```bash
git add src/app/(app)/dashboard/inventory/page.tsx
git commit -m "perf: relax inventory dashboard polling intervals

All queries: 60s → 120s
Add explicit staleTime to all queries."
```

---

### Task 7: Memoization Fix — `useDynamicFilterOptions`

**Files:**
- Modify: `src/hooks/use-dynamic-filter-options.ts`

**Step 1: Replace the hook implementation**

The current hook creates a new object reference via `setDynamicFilterOptions(optionsMap)` every time the fetch completes, even when the data hasn't changed. This triggers column regeneration in every entity data table.

Replace the entire file with:

```typescript
"use client";

/**
 * Hook to fetch dynamic filter options from Supabase.
 *
 * Handles both legacy `fetchOptions` and new `dynamicOptions` patterns.
 * Returns a stable map of field name → options array. Only triggers
 * re-renders when the actual option data changes (deep comparison).
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { EntityFilterDef } from "@/types/entity";

export type DynamicFilterOptions = Record<
  string,
  { value: string; label: string }[]
>;

/**
 * Shallow-compare two DynamicFilterOptions maps.
 * Returns true if they have the same keys with the same option arrays
 * (compared by value+label of each entry).
 */
function optionsEqual(
  a: DynamicFilterOptions,
  b: DynamicFilterOptions
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    const arrA = a[key];
    const arrB = b[key];
    if (!arrB || arrA.length !== arrB.length) return false;
    for (let i = 0; i < arrA.length; i++) {
      if (arrA[i].value !== arrB[i].value || arrA[i].label !== arrB[i].label) {
        return false;
      }
    }
  }
  return true;
}

export function useDynamicFilterOptions(
  listFilters: EntityFilterDef[] | undefined,
  entityName: string
): DynamicFilterOptions {
  const supabase = useMemo(() => createClient(), []);
  const [dynamicFilterOptions, setDynamicFilterOptions] =
    useState<DynamicFilterOptions>({});
  const prevOptionsRef = useRef<DynamicFilterOptions>({});

  // Stable setter that only updates state when data actually changes
  const setOptionsIfChanged = useCallback(
    (newOptions: DynamicFilterOptions) => {
      if (!optionsEqual(prevOptionsRef.current, newOptions)) {
        prevOptionsRef.current = newOptions;
        setDynamicFilterOptions(newOptions);
      }
    },
    []
  );

  // Reset when navigating between entities
  useEffect(() => {
    prevOptionsRef.current = {};
    setDynamicFilterOptions({});
  }, [entityName]);

  // Fetch dynamic filter options
  useEffect(() => {
    const fetchDynamicOptions = async () => {
      const filtersWithDynamicOptions =
        listFilters?.filter((f) => f.fetchOptions || f.dynamicOptions) || [];
      if (filtersWithDynamicOptions.length === 0) return;

      const results = await Promise.all(
        filtersWithDynamicOptions.map(async (filter) => {
          try {
            // Handle legacy fetchOptions
            if (filter.fetchOptions) {
              const options = await filter.fetchOptions();
              return { field: filter.field, options };
            }

            // Handle dynamicOptions (fetch from database)
            if (filter.dynamicOptions) {
              const {
                table,
                valueField,
                labelField,
                filter: queryFilter,
                orderBy,
              } = filter.dynamicOptions;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              let query = (supabase as any)
                .from(table)
                .select(`${valueField}, ${labelField}`);

              // Apply filter if specified
              if (queryFilter) {
                Object.entries(queryFilter).forEach(([key, value]) => {
                  query = query.eq(
                    key,
                    value as string | number | boolean
                  );
                });
              }

              // Apply ordering if specified
              if (orderBy) {
                const orderFields = orderBy.split(",").map((f) => f.trim());
                orderFields.forEach((field) => {
                  query = query.order(field, { ascending: true });
                });
              } else {
                query = query.order(labelField, { ascending: true });
              }

              const { data, error } = await query;
              if (error) throw error;

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const options = (data || []).map((row: any) => ({
                value: String(row[valueField]),
                label: String(row[labelField]),
              }));
              return { field: filter.field, options };
            }

            return { field: filter.field, options: [] };
          } catch (error) {
            console.error(
              `Failed to fetch options for filter ${filter.field}:`,
              error
            );
            return { field: filter.field, options: [] };
          }
        })
      );

      const optionsMap = results.reduce(
        (acc, { field, options }) => ({ ...acc, [field]: options }),
        {} as DynamicFilterOptions
      );

      setOptionsIfChanged(optionsMap);
    };

    fetchDynamicOptions();
  }, [listFilters, entityName, supabase, setOptionsIfChanged]);

  return dynamicFilterOptions;
}
```

**Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: 0 errors

**Step 3: Run tests**

Run: `pnpm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/hooks/use-dynamic-filter-options.ts
git commit -m "perf: stabilize useDynamicFilterOptions return reference

Add deep comparison before setState to prevent unnecessary re-renders
when filter options haven't actually changed. Stops cascading column
regeneration in every entity data table."
```

---

### Task 8: Memoization Fix — Data Table Cell Renderers

**Files:**
- Modify: `src/lib/data-table-adapter.tsx`

**Step 1: Extract stable CellRenderer component**

Add a `React.memo`-wrapped cell renderer component above the `buildDataTableColumns` function. This prevents TanStack Table from re-rendering every cell when column definitions are regenerated.

Add this import at the top of the file (after existing imports):

```typescript
import { memo } from "react";
```

Add this component before `buildDataTableColumns`:

```tsx
/**
 * Stable cell renderer component.
 * Wrapped in React.memo to prevent re-renders when column defs regenerate
 * but the actual cell data hasn't changed.
 */
const CellRenderer = memo(function CellRenderer<T>({
  value,
  original,
  col,
}: {
  value: unknown;
  original: T;
  col: EntityColumnDef<T>;
}) {
  if (col.render) {
    return col.render(value, original);
  }

  if (col.format === "unit" && col.unitType) {
    return <UnitDisplay value={value as number | null} unitType={col.unitType} />;
  }

  return formatValue(value, col.format);
}) as <T>(props: {
  value: unknown;
  original: T;
  col: EntityColumnDef<T>;
}) => React.ReactElement | string | null;
```

Then update the `cell` property inside `buildDataTableColumns` (line ~96-108) from:

```typescript
      cell: ({ row }: { row: { getValue: (id: string) => unknown; original: T } }) => {
        const value = accessorKey ? row.getValue(accessorKey) : null;

        if (col.render) {
          return col.render(value, row.original);
        }

        if (col.format === "unit" && col.unitType) {
          return <UnitDisplay value={value as number | null} unitType={col.unitType} />;
        }

        return formatValue(value, col.format);
      },
```

To:

```typescript
      cell: ({ row }: { row: { getValue: (id: string) => unknown; original: T } }) => {
        const value = accessorKey ? row.getValue(accessorKey) : null;
        return <CellRenderer value={value} original={row.original} col={col} />;
      },
```

**Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: 0 errors

**Step 3: Run tests**

Run: `pnpm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/lib/data-table-adapter.tsx
git commit -m "perf: extract memoized CellRenderer in data table adapter

Wraps cell rendering in React.memo so TanStack Table can skip
re-rendering cells when column definitions regenerate but cell
data hasn't changed. Benefits every entity list page."
```

---

### Task 9: Chat API — Use Pre-Aggregated View

**Files:**
- Modify: `src/app/api/chat/tools.ts`

**Step 1: Replace getBatchStatus implementation**

Find the `getBatchStatus` tool (around line 139-153). Replace the `execute` function body:

From:
```typescript
      execute: async () => {
        const data = await query<{ status: string }[]>(
          supabase.from("batches").select("status").neq("status", "cancelled"),
        );
        const summary: Record<string, number> = {};
        for (const { status } of data) {
          summary[status] = (summary[status] || 0) + 1;
        }
        return summary;
      },
```

To:
```typescript
      execute: async () => {
        const data = await query<{ status: string; count: number }[]>(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase as any).from("batch_status_counts").select("status, count"),
        );
        const summary: Record<string, number> = {};
        for (const { status, count } of data) {
          if (status !== "cancelled") {
            summary[status] = count;
          }
        }
        return summary;
      },
```

**Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/app/api/chat/tools.ts
git commit -m "perf: use batch_status_counts view in chat getBatchStatus tool

Replaces full table scan + JS aggregation with single query to
pre-aggregated view. Same output, fewer bytes over the wire."
```

---

### Task 10: Add Loading Boundary

**Files:**
- Create: `src/app/(app)/loading.tsx`

**Step 1: Create loading.tsx**

```tsx
import { Skeleton } from "@/components/ui/skeleton";

/**
 * App-wide loading skeleton.
 * Displayed by Next.js Suspense while page components are loading.
 */
export default function AppLoading() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Page title skeleton */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96" />
      </div>

      {/* Content area skeleton */}
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
```

**Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/app/\(app\)/loading.tsx
git commit -m "feat: add app-wide loading skeleton boundary

Enables React Suspense streaming for authenticated routes.
Shows skeleton UI during page transitions."
```

---

### Task 11: Add Error Boundary

**Files:**
- Create: `src/app/(app)/error.tsx`

**Step 1: Create error.tsx**

```tsx
"use client";

/**
 * App-wide error boundary.
 * Catches unhandled errors in authenticated routes and provides
 * a reset button. Uses Next.js error.tsx convention.
 */

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error("App error boundary:", error);
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-[50vh] p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Something went wrong
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            An unexpected error occurred. You can try again or navigate to
            another page.
          </p>
          {error.digest && (
            <p className="text-xs text-muted-foreground font-mono">
              Error ID: {error.digest}
            </p>
          )}
          <div className="flex gap-2">
            <Button onClick={reset}>Try Again</Button>
            <Button variant="outline" onClick={() => window.location.assign("/")}>
              Go to Dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/app/\(app\)/error.tsx
git commit -m "feat: add app-wide error boundary with reset

Catches unhandled errors in authenticated routes. Shows error
card with 'Try Again' and 'Go to Dashboard' options."
```

---

### Task 12: Final Validation

**Step 1: Run full type check**

Run: `pnpm typecheck`
Expected: 0 errors

**Step 2: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

**Step 3: Run lint**

Run: `pnpm lint`
Expected: No new errors introduced

**Step 4: Run build**

Run: `pnpm build`
Expected: Build succeeds. Note any bundle size changes in output.

**Step 5: Smoke test**

Run: `pnpm dev` and verify:
1. Dashboard loads — stats appear after initial fetch
2. Navigate between pages — loading skeleton appears briefly
3. Open chat panel (Cmd+. or click toggle) — panel loads and works
4. Entity list pages (e.g., /production/batches) — table renders correctly
5. Check browser Network tab — confirm dashboard polls at 60s/120s intervals, not 30s
