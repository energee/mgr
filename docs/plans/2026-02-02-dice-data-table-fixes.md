# Dice Data Table Code Review Fixes

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all critical, important, and suggestion-level issues from the code review of the Dice UI data table integration.

**Architecture:** The core fix is removing the disconnected dual state management. Since `DataTableFilterList` and `DataTableSortList` both manage their own state internally (filters via nuqs URL state, sorting via `table.setSorting`), EntityDataTable does NOT need to manage filter/sort state itself — it should react to URL changes for refetching. The table instance needs `manualFiltering: true` but should NOT include client-side filter row models since filtering is server-side.

**Tech Stack:** React, TanStack Table, nuqs, Supabase PostgREST, Next.js

---

### Task 1: Fix supabase infinite loop in useDynamicFilterOptions (I1)

**Files:**
- Modify: `src/hooks/use-dynamic-filter-options.ts`

**Step 1: Fix the dependency**

Move `createClient()` call outside the component body into a module-level singleton (since `createBrowserClient` creates a new object each time). Remove `supabase` from the useEffect dependency array, use `entityName` as the trigger instead (already present via the reset effect).

In `src/hooks/use-dynamic-filter-options.ts`:
- Remove `const supabase = createClient();` from inside the function
- Add `import { useMemo } from "react"` and use `useMemo` to stabilize the client ref
- Change the useEffect dependency from `[listFilters, supabase]` to `[listFilters, entityName]`
- Use the stable supabase ref inside the effect

**Step 2: Verify no infinite re-renders**

Run: `pnpm lint`

**Step 3: Commit**

```bash
git add src/hooks/use-dynamic-filter-options.ts
git commit -m "fix: stabilize supabase client ref in useDynamicFilterOptions"
```

---

### Task 2: Fix state management disconnect (C1 + C2)

**Files:**
- Modify: `src/components/universal/entity-data-table.tsx`

This is the core architectural fix. The `DataTableFilterList` manages its own filter state via nuqs (`?filters=...` URL param). The `DataTableSortList` reads/writes via `table.getState().sorting` / `table.setSorting`. So:

1. **Keep `sorting` as React state** — DataTableSortList works with it via the table instance
2. **Remove `columnFilters` React state** — DataTableFilterList manages filters via nuqs URL, not via the table's columnFilters
3. **Read filter state from nuqs URL** for the Supabase query instead
4. **Remove `getFilteredRowModel`, `getFacetedRowModel`, `getFacetedUniqueValues`** — with `manualFiltering: true`, these are unused
5. **Keep `manualFiltering: true`** — filtering IS server-side

**Step 1: Add nuqs imports and read filter state from URL**

Add imports for `useQueryState` and `getFiltersStateParser` from nuqs/parsers. Use `useQueryState` to read the `filters` URL param (same key that `DataTableFilterList` writes to). Convert the parsed filter items into the Supabase query in the `queryFn`.

Replace the `columnFilters` useState + filterKey useMemo with:

```typescript
import { useQueryState } from "nuqs";
import { getFiltersStateParser } from "@/lib/parsers";

// Inside component:
const filterableColumnIds = useMemo(
  () => columns.filter(c => c.enableColumnFilter).map(c => c.id).filter(Boolean) as string[],
  [columns]
);

const [urlFilters] = useQueryState(
  "filters",
  getFiltersStateParser(filterableColumnIds).withDefault([])
);
```

**Step 2: Update the query to use URL filters**

Replace `buildSupabaseFilters(columnFilters, ...)` with a new function that translates the nuqs `ExtendedColumnFilter[]` format (which has `id`, `value`, `operator`, `variant`) into Supabase queries. The existing `buildSupabaseFilters` expects TanStack `ColumnFiltersState` format — we need to handle the nuqs format instead.

In `src/lib/data-table-adapter.tsx`, add a new function `buildSupabaseFiltersFromUrl` that handles the `ExtendedColumnFilter` format with operators like `iLike`, `eq`, `ne`, `inArray`, `notInArray`, `lt`, `gt`, `lte`, `gte`, `isEmpty`, `isNotEmpty`, `isBetween`.

**Step 3: Remove unused client-side filter state and models**

Remove from EntityDataTable:
- `const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);`
- `columnFilters` from the reset useEffect
- `onColumnFiltersChange: setColumnFilters` from useReactTable
- `getFilteredRowModel`, `getFacetedRowModel`, `getFacetedUniqueValues` from useReactTable
- The `filterKey` useMemo (replace with URL filter state for query key)
- `columnFilters` from table state

Keep:
- `manualFiltering: true`
- `getCoreRowModel`, `getSortedRowModel`, `getPaginationRowModel`

**Step 4: Update hasActiveFilters check**

Replace `columnFilters.length > 0` with `urlFilters.length > 0`.

**Step 5: Verify and commit**

Run: `pnpm lint`

```bash
git add src/components/universal/entity-data-table.tsx src/lib/data-table-adapter.tsx
git commit -m "fix: connect DataTableFilterList nuqs state to Supabase query"
```

---

### Task 3: Add search debouncing (I2)

**Files:**
- Modify: `src/components/universal/entity-data-table.tsx`

**Step 1: Add debounced search**

Import `useDebouncedCallback` from `@/hooks/use-debounced-callback`. Keep `globalFilter` as the display value but create a separate `debouncedSearch` state that the query uses:

```typescript
const [globalFilter, setGlobalFilter] = useState("");
const [debouncedSearch, setDebouncedSearch] = useState("");
const debouncedSetSearch = useDebouncedCallback(setDebouncedSearch, 300);

// When globalFilter changes, debounce it
useEffect(() => {
  debouncedSetSearch(globalFilter);
}, [globalFilter, debouncedSetSearch]);
```

Use `debouncedSearch` in the queryFn and query key instead of `globalFilter`.

**Step 2: Commit**

```bash
git add src/components/universal/entity-data-table.tsx
git commit -m "fix: debounce global search to avoid excessive queries"
```

---

### Task 4: Sanitize search/filter input (I3)

**Files:**
- Modify: `src/components/universal/entity-data-table.tsx`
- Modify: `src/lib/data-table-adapter.tsx`

**Step 1: Add PostgREST escape helper**

In `data-table-adapter.tsx`, add a helper function:

```typescript
/** Escape special characters for PostgREST filter strings and SQL LIKE patterns */
function escapeFilterValue(value: string): string {
  // Escape SQL LIKE wildcards
  return value.replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Escape special characters for PostgREST .or() filter strings */
function escapePostgrestValue(value: string): string {
  // Escape characters that have meaning in PostgREST filter syntax
  return value.replace(/[%_\\]/g, (c) => `\\${c}`);
}
```

**Step 2: Apply escaping in global search**

In `entity-data-table.tsx`, escape the search value before interpolation:

```typescript
const escaped = debouncedSearch.replace(/[%_\\,().]/g, (c) => `\\${c}`);
const searchCondition = entity.searchableFields
  .map((field) => `${field}.ilike.%${escaped}%`)
  .join(",");
```

**Step 3: Apply escaping in ilike filters**

In `data-table-adapter.tsx` `buildSupabaseFiltersFromUrl`, escape `%` and `_` in text filter values before using `.ilike()`.

**Step 4: Commit**

```bash
git add src/components/universal/entity-data-table.tsx src/lib/data-table-adapter.tsx
git commit -m "fix: escape special characters in search and filter inputs"
```

---

### Task 5: Add server-side state machine validation to bulk updates (I4)

**Files:**
- Modify: `src/components/universal/entity-data-table.tsx`

**Step 1: Validate transitions before update**

Instead of a single bulk `.update().in("id", ids)`, fetch current states first and validate each transition:

```typescript
const handleBulkStatusChange = useCallback(
  async (targetStatus: string) => {
    if (!entity.stateMachine || !targetStatus || selectedRows.length === 0)
      return;

    const stateField = entity.stateMachine.stateField;
    const transitions = entity.stateMachine.transitions;
    const ids = selectedRows.map(
      (row) => (row as Record<string, unknown>).id as string
    );

    // Fetch current states to validate transitions
    const { data: currentData, error: fetchError } = await db
      .from(entity.table)
      .select(`id, ${stateField}`)
      .in("id", ids);

    if (fetchError) throw fetchError;

    // Only update rows where transition is valid
    const validIds = (currentData || [])
      .filter((row: Record<string, unknown>) => {
        const currentState = row[stateField] as string;
        const allowed = transitions[currentState] || [];
        return allowed.includes(targetStatus);
      })
      .map((row: Record<string, unknown>) => row.id as string);

    if (validIds.length === 0) {
      toast.error("No valid transitions available. Data may have changed.");
      return 0;
    }

    const { error } = await db
      .from(entity.table)
      .update({ [stateField]: targetStatus })
      .in("id", validIds);

    if (error) throw error;

    // Invalidate + clear selection
    queryClient.invalidateQueries({ queryKey: entityKeys.all(fetchTable) });
    if (entity.viewTable) {
      queryClient.invalidateQueries({ queryKey: entityKeys.all(entity.table) });
    }
    setRowSelection({});
    return validIds.length;
  },
  [entity, selectedRows, db, queryClient, fetchTable]
);
```

Import `toast` from `sonner` if not already imported.

**Step 2: Commit**

```bash
git add src/components/universal/entity-data-table.tsx
git commit -m "fix: validate state transitions server-side before bulk update"
```

---

### Task 6: Use getStateLabel in BulkStatusActionBar (S4)

**Files:**
- Modify: `src/components/universal/bulk-status-action-bar.tsx`

**Step 1: Replace direct label access with getStateLabel**

```typescript
import { getStateLabel } from "@/types/entity";

// In bulkTransitionOptions computation, replace:
//   label: stateDisplay?.[state]?.label || state,
// With:
//   label: getStateLabel(entity, state),

// In handleApply toast, replace:
//   entity.stateMachine?.stateDisplay?.[bulkTargetStatus]?.label || bulkTargetStatus
// With:
//   getStateLabel(entity, bulkTargetStatus)
```

**Step 2: Commit**

```bash
git add src/components/universal/bulk-status-action-bar.tsx
git commit -m "fix: use getStateLabel per DEC-007 in BulkStatusActionBar"
```

---

### Task 7: Fix naive pluralization (S3)

**Files:**
- Modify: `src/components/universal/entity-data-table.tsx`

**Step 1: Use displayNamePlural for path**

Replace:
```typescript
const path = basePath || `/${entity.domain}/${entity.name}s`;
```

With a lookup from the entity table name (which is already the plural slug):
```typescript
const path = basePath || `/${entity.domain}/${entity.table}`;
```

The `entity.table` is already the plural form used in URLs (e.g., "batches", "recipes", "vessels").

**Step 2: Commit**

```bash
git add src/components/universal/entity-data-table.tsx
git commit -m "fix: use entity.table for URL path instead of naive pluralization"
```

---

### Task 8: Remove dead code (S1)

**Files:**
- Delete: `src/hooks/use-data-table.ts`
- Delete: `src/components/data-table/data-table-skeleton.tsx`
- Delete: `src/components/data-table/data-table-toolbar.tsx`

These three files are not imported anywhere in the codebase. The toolbar is only imported by the unused faceted-filter, date-filter, and slider-filter files, which are only imported by the toolbar itself (circular, all unused).

Wait — the faceted-filter, date-filter, and slider-filter are imported by data-table-toolbar.tsx. Since toolbar is unused, the whole cluster is dead code. Delete the cluster:

- Delete: `src/hooks/use-data-table.ts`
- Delete: `src/components/data-table/data-table-skeleton.tsx`
- Delete: `src/components/data-table/data-table-toolbar.tsx`
- Delete: `src/components/data-table/data-table-faceted-filter.tsx`
- Delete: `src/components/data-table/data-table-date-filter.tsx`
- Delete: `src/components/data-table/data-table-slider-filter.tsx`

**Step 1: Delete unused files**

```bash
rm src/hooks/use-data-table.ts
rm src/components/data-table/data-table-skeleton.tsx
rm src/components/data-table/data-table-toolbar.tsx
rm src/components/data-table/data-table-faceted-filter.tsx
rm src/components/data-table/data-table-date-filter.tsx
rm src/components/data-table/data-table-slider-filter.tsx
```

**Step 2: Verify nothing breaks**

Run: `pnpm lint`

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove unused Dice UI data table files"
```

---

### Task 9: Final verification

**Step 1: Run full lint**

```bash
pnpm lint
```

**Step 2: Run type check**

```bash
pnpm tsc --noEmit
```

Fix any issues found.

**Step 3: Final commit if needed**
