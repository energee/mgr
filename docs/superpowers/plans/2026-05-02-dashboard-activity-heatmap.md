# Dashboard Activity Heatmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the daily bar chart in the "Batches Scheduled" section of `/dashboard` with a year-view GitHub-style activity heatmap (planned-by-day + completed-day dot), and convert the adjacent "Volume Brewed" chart to ~52 weekly bars over the same year window.

**Architecture:** A new client component `BatchActivityHeatmap` reads daily planned + completed counts from a new Postgres RPC (`get_planned_batches_by_day`) and renders a 7-row × ~53-column SVG-ish grid using DOM divs (Tailwind). Clicking a cell deep-links to the existing batches list with a `daterange` URL filter (already supported by `entity-data-table`). The volume chart reuses the existing `TrendChart` with client-side ISO-week bucketing of the existing `get_production_trends` RPC called with `p_days: 365`.

**Tech Stack:** Next.js App Router, React, TanStack Query, Supabase (Postgres + RPC + RLS), nuqs URL state, Recharts (existing TrendChart), Tailwind, shadcn/ui (Tooltip primitives), date-fns, Vitest.

---

## File Structure

| File | Purpose |
|---|---|
| `supabase/migrations/00170_get_planned_batches_by_day.sql` | **New.** RPC returning one row per day for the requested window: `(date, planned_count, completed_count)`. |
| `src/components/dashboard/heatmap-utils.ts` | **New.** Pure helpers: build the 365-day grid, assign intensity buckets, compute ISO-week buckets, build the filter-deep-link URL. All logic that doesn't touch React lives here. |
| `src/components/dashboard/__tests__/heatmap-utils.test.ts` | **New.** Vitest unit tests for `heatmap-utils.ts`. |
| `src/components/dashboard/batch-activity-heatmap.tsx` | **New.** Client component. Fetches data, renders grid + tooltips + legend, wires click. |
| `src/components/dashboard/index.ts` | Modify — export the new component. |
| `src/lib/query-keys.ts` | Modify — add `dashboardKeys.heatmap.year()` and `dashboardKeys.trends.weeklyVolume()`. |
| `src/entities/batch.tsx` | Modify — add a `planned_start_date` `daterange` filter to `listFilters`. |
| `src/app/(app)/dashboard/page.tsx` | Modify — replace the "Batches Scheduled" `TrendChart` with `<BatchActivityHeatmap />`; convert "Volume Brewed" `TrendChart` to weekly bars sourced from a year-window query. |

**Decomposition rationale:** Pure helpers (`heatmap-utils.ts`) split from the React component so the date math, bucketing, and URL building are unit-testable without rendering. Migration sits alone. Entity config + query-keys + dashboard page edits are small surgical changes.

**Branch / worktree:** Run in the worktree the user designates. Do not commit to `main` directly. If running this plan from `main`, stop and ask the user which worktree/branch to use first. Verify with `pwd` and `git branch --show-current` before any edit.

---

## Conventions referenced in this plan

- Test runner: `bun test:watch` for iteration; `bun test` for full suite (the project's `bun test` script runs `vitest run`). Note: `bun run test` invokes vitest; bare `bun test` is Bun's native runner — use `bun run test` per project convention.
- Type check: `bun typecheck`.
- Lint: `bun lint`.
- Migration apply (local): `bunx supabase migration up` (or `supabase db push` for remote — leave that to the user).
- Date library in use: `date-fns`. Use `parseISO`, `format`, `startOfWeek`, `endOfWeek`, `eachDayOfInterval`, `differenceInCalendarDays`.
- All `useQuery` keys MUST come from `src/lib/query-keys.ts` factories.
- Status display rule (DEC-007) and no-empty-strings-in-Select (DEC-008) — neither relevant here, but don't violate them in passing.
- Migrations: `SECURITY INVOKER` + `SET search_path = public`. Use `CREATE OR REPLACE FUNCTION`.
- Latest applied migration is `00169` (verify with `ls supabase/migrations/ | tail -5` before writing the file). Use the next available number.

---

## Task 1: Add the `get_planned_batches_by_day` RPC

**Files:**
- Create: `supabase/migrations/00170_get_planned_batches_by_day.sql` (verify number first)

- [ ] **Step 1: Verify the next migration number**

```bash
ls supabase/migrations/ | grep -E '^00[0-9]+_' | sort | tail -3
```

Expected: a list ending with `00169_*`. If something higher exists, use `next + 1` instead of `00170` everywhere in this task.

- [ ] **Step 2: Write the migration file**

Path: `supabase/migrations/00170_get_planned_batches_by_day.sql`

```sql
-- =============================================================================
-- Migration: 00170_get_planned_batches_by_day
--
-- Adds get_planned_batches_by_day(p_days), which returns one row per day in
-- the trailing window with two counts:
--
--   planned_count    Count of batches whose planned_start_date == day.
--   completed_count  Count of batches that completed (status changed to
--                    'completed') on that day. Approximated via
--                    actual_end_date when available, falling back to
--                    updated_at::date for completed batches without a
--                    recorded end date.
--
-- The window is dense (one row per day) via generate_series so the client
-- can render a heatmap without holes.
-- =============================================================================

CREATE OR REPLACE FUNCTION get_planned_batches_by_day(
  p_days INTEGER DEFAULT 365
)
RETURNS TABLE (
  day              DATE,
  planned_count    INTEGER,
  completed_count  INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH days AS (
    SELECT generate_series(
      (CURRENT_DATE - (p_days - 1))::DATE,
      CURRENT_DATE,
      INTERVAL '1 day'
    )::DATE AS day
  ),
  planned AS (
    SELECT planned_start_date::DATE AS day, COUNT(*)::INTEGER AS n
    FROM batches
    WHERE planned_start_date IS NOT NULL
      AND planned_start_date::DATE >= (CURRENT_DATE - (p_days - 1))
      AND planned_start_date::DATE <= CURRENT_DATE
    GROUP BY planned_start_date::DATE
  ),
  completed AS (
    SELECT
      COALESCE(actual_end_date::DATE, updated_at::DATE) AS day,
      COUNT(*)::INTEGER AS n
    FROM batches
    WHERE status = 'completed'
      AND COALESCE(actual_end_date::DATE, updated_at::DATE)
            BETWEEN (CURRENT_DATE - (p_days - 1)) AND CURRENT_DATE
    GROUP BY COALESCE(actual_end_date::DATE, updated_at::DATE)
  )
  SELECT
    d.day,
    COALESCE(p.n, 0) AS planned_count,
    COALESCE(c.n, 0) AS completed_count
  FROM days d
  LEFT JOIN planned   p ON p.day = d.day
  LEFT JOIN completed c ON c.day = d.day
  ORDER BY d.day;
END;
$$;

COMMENT ON FUNCTION get_planned_batches_by_day(INTEGER) IS
  'Daily counts of planned and completed batches over the trailing N days. Used by the dashboard activity heatmap.';

-- Refresh PostgREST schema cache so the new RPC is reachable from the client.
NOTIFY pgrst, 'reload schema';
```

**Note:** If the `batches` table does not have an `actual_end_date` column, drop it from the COALESCE and use `updated_at::DATE` alone. Verify with: `grep -n "actual_end_date\|updated_at" supabase/migrations/*batches*.sql | head -5` before applying.

- [ ] **Step 3: Apply the migration locally**

```bash
bunx supabase migration up
```

Expected output: includes `Applying migration 00170_get_planned_batches_by_day.sql...` followed by no error. If `supabase` CLI is not started, run `bunx supabase start` first.

- [ ] **Step 4: Smoke-test the RPC against local DB**

```bash
bunx supabase db query "SELECT * FROM get_planned_batches_by_day(7) ORDER BY day;"
```

Expected: 7 rows, one per day for the last week, with `planned_count` and `completed_count` columns (likely zeros on a fresh DB; that's fine — we're verifying shape and that the function executes without error).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00170_get_planned_batches_by_day.sql
git commit -m "feat(db): add get_planned_batches_by_day RPC for activity heatmap"
```

---

## Task 2: Pure helpers for the heatmap (test-first)

**Files:**
- Create: `src/components/dashboard/heatmap-utils.ts`
- Create: `src/components/dashboard/__tests__/heatmap-utils.test.ts`

These are pure functions — no React, no DOM. We TDD them.

- [ ] **Step 1: Write the failing test file**

Path: `src/components/dashboard/__tests__/heatmap-utils.test.ts`

```ts
/**
 * Unit tests for heatmap pure helpers.
 *
 * Covers grid construction, intensity bucketing, ISO-week bucketing for the
 * weekly volume chart, and deep-link URL building for click-to-filter.
 */

import { describe, it, expect } from "vitest";
import {
  buildDayGrid,
  bucketForCount,
  bucketWeekly,
  buildPlannedDateFilterHref,
  type DayCell,
} from "../heatmap-utils";

describe("bucketForCount", () => {
  it("returns 0 for zero", () => {
    expect(bucketForCount(0)).toBe(0);
  });
  it("returns 1 for 1", () => {
    expect(bucketForCount(1)).toBe(1);
  });
  it("returns 2 for 2", () => {
    expect(bucketForCount(2)).toBe(2);
  });
  it("returns 3 for 3", () => {
    expect(bucketForCount(3)).toBe(3);
  });
  it("returns 4 for any value >= 4", () => {
    expect(bucketForCount(4)).toBe(4);
    expect(bucketForCount(7)).toBe(4);
    expect(bucketForCount(99)).toBe(4);
  });
});

describe("buildDayGrid", () => {
  // anchor = the LAST day of the window (today)
  const anchor = new Date("2026-05-02T12:00:00Z"); // a Saturday

  it("returns 365 day cells when given 365 rows", () => {
    const rows = Array.from({ length: 365 }, (_, i) => ({
      day: new Date(anchor.getTime() - (364 - i) * 86400000)
        .toISOString()
        .slice(0, 10),
      planned_count: 0,
      completed_count: 0,
    }));
    const grid = buildDayGrid(rows, anchor);
    expect(grid.cells.length).toBe(365);
  });

  it("aligns the grid to weeks: first column may have leading empty slots", () => {
    const rows = Array.from({ length: 365 }, (_, i) => ({
      day: new Date(anchor.getTime() - (364 - i) * 86400000)
        .toISOString()
        .slice(0, 10),
      planned_count: 0,
      completed_count: 0,
    }));
    const grid = buildDayGrid(rows, anchor);
    // weeks should be ceil((365 + leading-pad) / 7), at least 53
    expect(grid.weeks).toBeGreaterThanOrEqual(53);
    expect(grid.leadingEmptyCells).toBeGreaterThanOrEqual(0);
    expect(grid.leadingEmptyCells).toBeLessThan(7);
  });

  it("preserves planned/completed counts on the right cells", () => {
    const rows: Array<{ day: string; planned_count: number; completed_count: number }> = [];
    for (let i = 0; i < 365; i++) {
      rows.push({
        day: new Date(anchor.getTime() - (364 - i) * 86400000)
          .toISOString()
          .slice(0, 10),
        planned_count: i === 100 ? 3 : 0,
        completed_count: i === 100 ? 1 : 0,
      });
    }
    const grid = buildDayGrid(rows, anchor);
    const cell = grid.cells.find(
      (c): c is DayCell => c.kind === "day" && c.planned === 3,
    );
    expect(cell).toBeDefined();
    expect(cell?.completed).toBe(1);
  });
});

describe("bucketWeekly", () => {
  it("groups daily values into ISO weeks (Mon-anchored)", () => {
    // 14 days starting Mon 2026-04-20
    const rows = Array.from({ length: 14 }, (_, i) => ({
      date: new Date(2026, 3, 20 + i).toISOString().slice(0, 10),
      volume: 1,
    }));
    const out = bucketWeekly(rows, "date", "volume");
    expect(out).toHaveLength(2);
    expect(out[0].volume).toBe(7);
    expect(out[1].volume).toBe(7);
  });

  it("zero-fills weeks with no data within the bounds", () => {
    const rows = [
      { date: "2026-04-20", volume: 5 },
      // skip a week
      { date: "2026-05-04", volume: 3 },
    ];
    const out = bucketWeekly(rows, "date", "volume");
    expect(out).toHaveLength(3);
    expect(out[0].volume).toBe(5);
    expect(out[1].volume).toBe(0);
    expect(out[2].volume).toBe(3);
  });

  it("returns the ISO week's Monday as the bucket date", () => {
    const out = bucketWeekly([{ date: "2026-04-22", volume: 1 }], "date", "volume");
    expect(out[0].date).toBe("2026-04-20"); // Monday of that week
  });
});

describe("buildPlannedDateFilterHref", () => {
  it("targets the batches list page", () => {
    const href = buildPlannedDateFilterHref("2026-03-12");
    expect(href.startsWith("/production/batches?")).toBe(true);
  });

  it("encodes a daterange isBetween filter for the given day", () => {
    const href = buildPlannedDateFilterHref("2026-03-12");
    const params = new URLSearchParams(href.split("?")[1]);
    const filters = JSON.parse(params.get("filters") ?? "[]");
    expect(filters).toHaveLength(1);
    expect(filters[0].id).toBe("planned_start_date");
    expect(filters[0].variant).toBe("dateRange");
    expect(filters[0].operator).toBe("isBetween");
    expect(filters[0].value).toEqual(["2026-03-12", "2026-03-12"]);
    expect(typeof filters[0].filterId).toBe("string");
    expect(filters[0].filterId.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify all four describes fail**

```bash
bun run test src/components/dashboard/__tests__/heatmap-utils.test.ts
```

Expected: FAIL with "Cannot find module '../heatmap-utils'" or similar.

- [ ] **Step 3: Implement `heatmap-utils.ts`**

Path: `src/components/dashboard/heatmap-utils.ts`

```ts
/**
 * Pure helpers for the dashboard activity heatmap.
 *
 * - buildDayGrid: turn a dense array of daily rows into a week-aligned grid
 *   suitable for a 7-row GitHub-style heatmap.
 * - bucketForCount: map a planned-count to a 0-4 intensity bucket.
 * - bucketWeekly: aggregate daily rows into ISO-week (Mon-anchored) buckets
 *   for the year volume bar chart.
 * - buildPlannedDateFilterHref: build a deep-link URL that filters the
 *   batches list page by planned_start_date (single day).
 */

import {
  startOfWeek,
  endOfWeek,
  eachWeekOfInterval,
  format,
  parseISO,
  differenceInCalendarDays,
} from "date-fns";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type DailyCount = {
  day: string; // ISO yyyy-mm-dd
  planned_count: number;
  completed_count: number;
};

export type DayCell = {
  kind: "day";
  day: string; // ISO yyyy-mm-dd
  planned: number;
  completed: number;
  bucket: 0 | 1 | 2 | 3 | 4;
};

export type EmptyCell = {
  kind: "empty";
};

export type GridCell = DayCell | EmptyCell;

export type DayGrid = {
  cells: GridCell[]; // length = weeks * 7, in column-major order
  weeks: number;
  leadingEmptyCells: number;
};

// ----------------------------------------------------------------------------
// bucketForCount
// ----------------------------------------------------------------------------

export function bucketForCount(n: number): 0 | 1 | 2 | 3 | 4 {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 4;
}

// ----------------------------------------------------------------------------
// buildDayGrid
//
// We render in column-major order (each column is one week, top→bottom = Sun→Sat).
// To make rendering trivial, we pad the first week with "empty" cells so that
// the very first day-of-week-zero (Sunday) of the oldest week aligns with the
// top of column 0.
// ----------------------------------------------------------------------------

export function buildDayGrid(rows: DailyCount[], anchor: Date): DayGrid {
  if (rows.length === 0) {
    return { cells: [], weeks: 0, leadingEmptyCells: 0 };
  }

  const byDay = new Map<string, DailyCount>();
  for (const r of rows) byDay.set(r.day, r);

  const firstRow = rows[0];
  const firstDate = parseISO(firstRow.day);
  const lastDate = parseISO(rows[rows.length - 1].day);

  // Sunday of the week containing the first day → column 0 row 0
  const gridStart = startOfWeek(firstDate, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(lastDate, { weekStartsOn: 0 });

  const totalDays = differenceInCalendarDays(gridEnd, gridStart) + 1;
  const weeks = Math.ceil(totalDays / 7);
  const leadingEmptyCells = differenceInCalendarDays(firstDate, gridStart);

  // Build cells in linear date order from gridStart. Index math:
  //   cells[col * 7 + row] = the cell at column=col (week), row=row (Sun..Sat).
  // Since gridStart is a Sunday and we step one day at a time, this naturally
  // lays out as column-major, top-to-bottom-then-left-to-right — exactly what
  // CSS grid with grid-auto-flow: column expects.
  const cells: GridCell[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const cellDate = new Date(gridStart);
    cellDate.setDate(gridStart.getDate() + i);
    if (cellDate < firstDate || cellDate > lastDate) {
      cells.push({ kind: "empty" });
      continue;
    }
    const iso = format(cellDate, "yyyy-MM-dd");
    const row = byDay.get(iso);
    const planned = row?.planned_count ?? 0;
    const completed = row?.completed_count ?? 0;
    cells.push({
      kind: "day",
      day: iso,
      planned,
      completed,
      bucket: bucketForCount(planned),
    });
  }

  return { cells, weeks, leadingEmptyCells };
}

// ----------------------------------------------------------------------------
// bucketWeekly
// ----------------------------------------------------------------------------

export function bucketWeekly<
  TKey extends string,
  TValue extends string,
  TRow extends Record<TKey, string> & Record<TValue, number>,
>(
  rows: TRow[],
  dateKey: TKey,
  valueKey: TValue,
): Array<{ date: string } & Record<TValue, number>> {
  if (rows.length === 0) return [];

  const start = startOfWeek(parseISO(rows[0][dateKey]), { weekStartsOn: 1 });
  const end = startOfWeek(parseISO(rows[rows.length - 1][dateKey]), {
    weekStartsOn: 1,
  });
  const weeks = eachWeekOfInterval({ start, end }, { weekStartsOn: 1 });

  const sums = new Map<string, number>();
  for (const r of rows) {
    const weekStart = format(
      startOfWeek(parseISO(r[dateKey]), { weekStartsOn: 1 }),
      "yyyy-MM-dd",
    );
    sums.set(weekStart, (sums.get(weekStart) ?? 0) + r[valueKey]);
  }

  return weeks.map((w) => {
    const iso = format(w, "yyyy-MM-dd");
    const out = { date: iso } as { date: string } & Record<TValue, number>;
    out[valueKey] = sums.get(iso) ?? 0;
    return out;
  });
}

// ----------------------------------------------------------------------------
// buildPlannedDateFilterHref
//
// Builds a URL that lands on /production/batches with a single-day daterange
// filter on planned_start_date pre-applied. Matches the entity-data-table's
// nuqs filter grammar: ?filters=<JSON-array>.
// ----------------------------------------------------------------------------

export function buildPlannedDateFilterHref(isoDay: string): string {
  const filter = {
    id: "planned_start_date",
    value: [isoDay, isoDay] as [string, string],
    variant: "dateRange",
    operator: "isBetween",
    filterId: makeShortId(),
  };
  const params = new URLSearchParams();
  params.set("filters", JSON.stringify([filter]));
  return `/production/batches?${params.toString()}`;
}

function makeShortId(): string {
  // 8-char alphanumeric. Crypto-strong not required — only used as a UI key
  // for the filter row; collisions just mean two rows share an internal id.
  let s = "";
  const alphabet =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  for (let i = 0; i < 8; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
bun run test src/components/dashboard/__tests__/heatmap-utils.test.ts
```

Expected: PASS. All four describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/heatmap-utils.ts src/components/dashboard/__tests__/heatmap-utils.test.ts
git commit -m "feat(dashboard): add pure helpers for activity heatmap"
```

---

## Task 3: Add query key factories

**Files:**
- Modify: `src/lib/query-keys.ts`

- [ ] **Step 1: Read the current file to see the existing `dashboardKeys` shape**

```bash
grep -n "dashboardKeys\|trends\|batchCounts" src/lib/query-keys.ts
```

- [ ] **Step 2: Add the new factories**

In `src/lib/query-keys.ts`, locate the existing `dashboardKeys` export. Add a `heatmap` namespace alongside the existing namespaces, and add a `weeklyVolume` factory inside `trends`.

```ts
// Inside the existing dashboardKeys object, add:
heatmap: {
  year: () => ["dashboard", "heatmap", "year"] as const,
},
// And inside dashboardKeys.trends, add:
weeklyVolume: () => ["dashboard", "trends", "weekly-volume"] as const,
```

If `dashboardKeys.trends` is built as nested factory functions (rather than a literal), follow the existing pattern. The exact location depends on the file structure — preserve the surrounding style.

- [ ] **Step 3: Verify the keys typecheck**

```bash
bun typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/query-keys.ts
git commit -m "feat(dashboard): add query keys for heatmap and weekly volume"
```

---

## Task 4: Add `planned_start_date` daterange filter to batch entity

**Files:**
- Modify: `src/entities/batch.tsx` — add to `listFilters`

- [ ] **Step 1: Read current `listFilters` block**

It's near `src/entities/batch.tsx:150-172`. Confirm the structure before editing.

- [ ] **Step 2: Add the daterange filter**

Append to the existing `listFilters` array:

```ts
{
  field: "planned_start_date",
  type: "daterange",
  label: "Planned start date",
},
```

- [ ] **Step 3: Verify typecheck and lint**

```bash
bun typecheck && bun lint
```

Expected: zero errors. (`daterange` is already in the `EntityFilterDef.type` union and already wired through `data-table-adapter.tsx`.)

- [ ] **Step 4: Manual smoke test**

```bash
bun dev
```

Open `http://localhost:3000/production/batches`. Click the filter button (top of table) and confirm "Planned start date" appears in the filter list with a daterange picker. Pick a range, confirm the URL updates with `?filters=...` and the table filters correctly.

- [ ] **Step 5: Commit**

```bash
git add src/entities/batch.tsx
git commit -m "feat(batches): add planned_start_date daterange filter"
```

---

## Task 5: Build the `BatchActivityHeatmap` component

**Files:**
- Create: `src/components/dashboard/batch-activity-heatmap.tsx`

This is the largest task. We'll build it in three commits: skeleton (data + grid), interactions (tooltip + click), and polish (legend + month labels).

### 5a — skeleton

- [ ] **Step 1: Write the skeleton component**

Path: `src/components/dashboard/batch-activity-heatmap.tsx`

```tsx
"use client";

/**
 * Batch Activity Heatmap
 *
 * GitHub-style year-view activity grid. 7 rows (days of week, Sun→Sat),
 * ~53 columns (weeks). Background color = planned batches that day
 * (5-bucket amber ramp). A small emerald dot indicates ≥1 completed batch
 * that day. Hover for tooltip; click navigates to the batches list filtered
 * by that day's planned_start_date.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dashboardKeys } from "@/lib/query-keys";
import { dynamicRpc } from "@/services/types";
import { CACHE_DURATIONS, POLLING_INTERVALS } from "@/lib/constants";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { format, parseISO } from "date-fns";
import {
  buildDayGrid,
  buildPlannedDateFilterHref,
  type DailyCount,
  type GridCell,
} from "./heatmap-utils";
import { cn } from "@/lib/utils";

const WINDOW_DAYS = 365;

const BUCKET_BG: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: "bg-muted",
  1: "bg-amber-200 dark:bg-amber-900",
  2: "bg-amber-400 dark:bg-amber-700",
  3: "bg-amber-600 dark:bg-amber-500",
  4: "bg-amber-800 dark:bg-amber-300",
};

export function BatchActivityHeatmap() {
  const supabase = createClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: dashboardKeys.heatmap.year(),
    queryFn: async () => {
      const { data, error } = await dynamicRpc(
        supabase,
        "get_planned_batches_by_day",
        { p_days: WINDOW_DAYS },
      );
      if (error) throw error;
      return ((data || []) as Array<{
        day: string;
        planned_count: number;
        completed_count: number;
      }>).map((r) => ({
        day: r.day,
        planned_count: Number(r.planned_count),
        completed_count: Number(r.completed_count),
      })) satisfies DailyCount[];
    },
    refetchInterval: POLLING_INTERVALS.NORMAL,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
  });

  const grid = useMemo(
    () => buildDayGrid(rows, new Date()),
    [rows],
  );

  if (isLoading && rows.length === 0) {
    return <div className="h-[112px] w-full animate-pulse rounded bg-muted/40" />;
  }

  if (grid.cells.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">No activity yet</div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div
        className="grid gap-[2px]"
        style={{
          gridTemplateColumns: `repeat(${grid.weeks}, 11px)`,
          gridTemplateRows: "repeat(7, 11px)",
          gridAutoFlow: "column",
        }}
        role="grid"
        aria-label="Batch activity heatmap (last 365 days)"
      >
        {grid.cells.map((cell, i) => (
          <Cell key={i} cell={cell} />
        ))}
      </div>
    </div>
  );
}

function Cell({ cell }: { cell: GridCell }) {
  if (cell.kind === "empty") {
    return <div className="h-[11px] w-[11px]" aria-hidden />;
  }
  return (
    <div
      className={cn(
        "relative h-[11px] w-[11px] rounded-[2px]",
        BUCKET_BG[cell.bucket],
      )}
      aria-label={`${cell.day}: ${cell.planned} planned, ${cell.completed} completed`}
    >
      {cell.completed > 0 ? (
        <span className="absolute inset-0 m-auto block h-[3px] w-[3px] rounded-full bg-emerald-500" />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Export from the dashboard index**

Add to `src/components/dashboard/index.ts`:

```ts
export { BatchActivityHeatmap } from "./batch-activity-heatmap";
```

- [ ] **Step 3: Typecheck**

```bash
bun typecheck
```

Expected: zero errors. If `dynamicRpc` doesn't accept the new function name in its typing, mirror how `get_production_trends` is called elsewhere (it uses `dynamicRpc` too — see `src/app/(app)/dashboard/page.tsx:439`).

- [ ] **Step 4: Commit the skeleton**

```bash
git add src/components/dashboard/batch-activity-heatmap.tsx src/components/dashboard/index.ts
git commit -m "feat(dashboard): add BatchActivityHeatmap skeleton"
```

### 5b — interactions (tooltip + click)

- [ ] **Step 5: Wrap each non-empty cell with Tooltip + Link**

Replace the `Cell` component body:

```tsx
function Cell({ cell }: { cell: GridCell }) {
  if (cell.kind === "empty") {
    return <div className="h-[11px] w-[11px]" aria-hidden />;
  }
  const label = `${format(parseISO(cell.day), "MMM d, yyyy")} · ${cell.planned} planned · ${cell.completed} completed`;
  const href = cell.planned > 0 ? buildPlannedDateFilterHref(cell.day) : null;

  const square = (
    <div
      className={cn(
        "relative h-[11px] w-[11px] rounded-[2px] transition-transform hover:scale-110",
        BUCKET_BG[cell.bucket],
      )}
    >
      {cell.completed > 0 ? (
        <span className="absolute inset-0 m-auto block h-[3px] w-[3px] rounded-full bg-emerald-500" />
      ) : null}
    </div>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Link href={href} aria-label={label}>
            {square}
          </Link>
        ) : (
          <button
            type="button"
            aria-label={label}
            className="cursor-default"
            tabIndex={-1}
          >
            {square}
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent>
        <span className="text-xs">{label}</span>
      </TooltipContent>
    </Tooltip>
  );
}
```

Verify the import: `import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";` — these are already imported at the top of the file.

If the rest of the codebase wraps tooltips in a `TooltipProvider`, ensure one wraps the heatmap (or that the global app layout already provides one — most shadcn projects do). Confirm with: `grep -rn "TooltipProvider" src/app/layout.tsx src/app/(app)/layout.tsx`.

- [ ] **Step 6: Typecheck and verify in browser**

```bash
bun typecheck && bun dev
```

Open `http://localhost:3000/dashboard`. Hover a square — tooltip should appear. Click a square with planned > 0 — should navigate to `/production/batches?filters=...` with the date pre-filtered.

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard/batch-activity-heatmap.tsx
git commit -m "feat(dashboard): tooltip + click-to-filter on heatmap cells"
```

### 5c — legend + month labels + day-of-week labels

- [ ] **Step 8: Add month labels above the grid, day-of-week labels on the left, and a legend below**

Replace the JSX returned by `BatchActivityHeatmap` with:

```tsx
return (
  <div className="space-y-2">
    <div className="overflow-x-auto">
      <div className="flex">
        <DayOfWeekLabels />
        <div className="flex flex-col">
          <MonthLabels grid={grid} />
          <div
            className="grid gap-[2px]"
            style={{
              gridTemplateColumns: `repeat(${grid.weeks}, 11px)`,
              gridTemplateRows: "repeat(7, 11px)",
              gridAutoFlow: "column",
            }}
            role="grid"
            aria-label="Batch activity heatmap (last 365 days)"
          >
            {grid.cells.map((cell, i) => (
              <Cell key={i} cell={cell} />
            ))}
          </div>
        </div>
      </div>
    </div>
    <Legend />
  </div>
);
```

Add the three helper components at the bottom of the file:

```tsx
function DayOfWeekLabels() {
  // Show only Mon (row 1), Wed (row 3), Fri (row 5) — GitHub convention.
  // Empty placeholders preserve vertical alignment for the other rows.
  // The mt aligns the labels with the grid (after the month labels' row).
  const rows: Array<string> = ["", "Mon", "", "Wed", "", "Fri", ""];
  return (
    <div
      className="mr-1 mt-[14px] grid text-[10px] leading-none text-muted-foreground"
      style={{ gridTemplateRows: "repeat(7, 11px)", rowGap: "2px" }}
    >
      {rows.map((label, i) => (
        <div key={i} className="flex items-center pr-1">
          {label}
        </div>
      ))}
    </div>
  );
}

function MonthLabels({ grid }: { grid: ReturnType<typeof buildDayGrid> }) {
  // Find the first cell of each month and emit its label at that column.
  const labels: Array<{ col: number; label: string }> = [];
  let lastMonth = -1;
  for (let col = 0; col < grid.weeks; col++) {
    const top = grid.cells[col * 7]; // top row of this column
    if (top.kind !== "day") continue;
    const m = parseISO(top.day).getMonth();
    if (m !== lastMonth) {
      lastMonth = m;
      labels.push({ col, label: format(parseISO(top.day), "MMM") });
    }
  }
  return (
    <div
      className="mb-1 grid text-xs text-muted-foreground"
      style={{ gridTemplateColumns: `repeat(${grid.weeks}, 11px)`, columnGap: "2px" }}
    >
      {Array.from({ length: grid.weeks }).map((_, col) => {
        const lbl = labels.find((l) => l.col === col)?.label ?? "";
        return (
          <div key={col} className="text-[10px] leading-none whitespace-nowrap">
            {lbl}
          </div>
        );
      })}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center justify-end gap-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-1">
        <span>Less</span>
        {([0, 1, 2, 3, 4] as const).map((b) => (
          <span key={b} className={cn("h-[11px] w-[11px] rounded-[2px]", BUCKET_BG[b])} />
        ))}
        <span>More</span>
      </div>
      <span aria-hidden>·</span>
      <div className="flex items-center gap-1">
        <span className="block h-[3px] w-[3px] rounded-full bg-emerald-500" />
        <span>completed</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Typecheck and verify visually**

```bash
bun typecheck && bun dev
```

Open `http://localhost:3000/dashboard`. The heatmap should now have:
- Month abbreviations above (Jan/Feb/…) at the column where each new month begins.
- Day-of-week labels (`Mon`, `Wed`, `Fri`) on the left, vertically aligned with rows 1, 3, and 5.
- A legend below the grid with the amber ramp and the emerald-dot indicator.

- [ ] **Step 10: Commit**

```bash
git add src/components/dashboard/batch-activity-heatmap.tsx
git commit -m "feat(dashboard): month labels + legend on activity heatmap"
```

---

## Task 6: Wire the heatmap and weekly volume into the dashboard page

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Add a year-window query alongside the existing period query**

Inside `ProductionTrends()` (around line 430), add a new `useQuery` that fetches `get_production_trends` with `p_days: 365` for the weekly volume chart.

```ts
const { data: yearTrends = [] } = useQuery({
  queryKey: dashboardKeys.trends.weeklyVolume(),
  queryFn: async () => {
    const { data, error } = await dynamicRpc(supabase, "get_production_trends", {
      p_days: 365,
    });
    if (error) {
      log.error("Failed to fetch year trends:", error);
      return [];
    }
    return (data || []) as Array<{
      date: string;
      batches_started: number;
      volume_bbl: number;
      batches_completed: number;
    }>;
  },
  refetchInterval: 60000,
  refetchIntervalInBackground: false,
  staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
});

const weeklyVolumeData = useMemo(() => {
  const inUnit = yearTrends.map((d) => ({
    date: d.date,
    volume_display: convertVolume(Number(d.volume_bbl), "bbl", volumeUnit),
  }));
  return bucketWeekly(inUnit, "date", "volume_display");
}, [yearTrends, volumeUnit]);
```

Add the import at the top of the file:

```ts
import { bucketWeekly } from "@/components/dashboard/heatmap-utils";
import { BatchActivityHeatmap } from "@/components/dashboard";
```

- [ ] **Step 2: Replace the two trend chart panels in the JSX**

Find the block at lines ~511-528:

```tsx
<div className="grid gap-6 md:grid-cols-2">
  <DashboardSection title="Batches Scheduled">
    <TrendChart ... batches_started ... />
  </DashboardSection>
  <DashboardSection title="Volume Brewed">
    <TrendChart data={volumeChartData} ... />
  </DashboardSection>
</div>
```

Replace with:

```tsx
<div className="grid gap-6 md:grid-cols-2">
  <DashboardSection title="Batches Scheduled">
    <BatchActivityHeatmap />
  </DashboardSection>
  <DashboardSection title="Volume Brewed">
    <TrendChart
      data={weeklyVolumeData}
      xKey="date"
      type="bar"
      series={[{ key: "volume_display", label: volumeLabel }]}
      formatValue={(v) => `${Number(v).toFixed(1)} ${volumeLabel}`}
    />
  </DashboardSection>
</div>
```

- [ ] **Step 3: Remove the now-unused `volumeChartData` memo**

The old `volumeChartData` `useMemo` (around line 463-470) is no longer referenced. Delete it. Run `bun typecheck` to confirm nothing else used it.

- [ ] **Step 4: Typecheck + lint**

```bash
bun typecheck && bun lint
```

Expected: zero errors.

- [ ] **Step 5: Manual smoke test**

```bash
bun dev
```

Open `http://localhost:3000/dashboard`. Verify:
- The "Batches Scheduled" panel shows the year heatmap with month labels and legend.
- Hovering a square shows a tooltip with date and counts.
- Clicking a square with `planned > 0` lands you on `/production/batches` with the day pre-filtered.
- The "Volume Brewed" panel shows ~52 bars of weekly volume.
- The three `StatCardWithDelta` cards above continue to update when you change the period selector (7d / 30d / 90d).

If the period selector also visibly affects the heatmap or the weekly volume chart — that's a bug; both should be year-fixed. Trace the query keys and remove any `period` usage from the year queries.

- [ ] **Step 6: Commit**

```bash
git add src/app/(app)/dashboard/page.tsx
git commit -m "feat(dashboard): swap batches scheduled bar chart for year heatmap; weekly volume chart"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run the full test suite**

```bash
bun run test
```

Expected: all tests pass. The new `heatmap-utils.test.ts` is among them.

- [ ] **Step 2: Run typecheck**

```bash
bun typecheck
```

Expected: zero errors.

- [ ] **Step 3: Run lint**

```bash
bun lint
```

Expected: zero errors. Any lint warnings introduced by this work must be fixed (do not commit suppressions).

- [ ] **Step 4: Manual end-to-end**

```bash
bun dev
```

Open `http://localhost:3000/dashboard`. Walk the acceptance criteria:
- Heatmap renders 7 rows × ≥53 columns with month labels above and Mon/Wed/Fri labels on the left.
- Squares are amber, intensity matches planned counts in a few cells you can verify by clicking through.
- Cells with completed batches show the emerald dot.
- Tooltips show `Mar 12, 2026 · N planned · M completed`.
- Clicking a planned cell deep-links to the batches list filtered to that day; the URL contains `?filters=` with `planned_start_date`.
- Volume Brewed shows a year of weekly bars.
- Period selector (7d/30d/90d) only affects the three delta cards above the panels.

- [ ] **Step 5: Take a screenshot for the PR description (optional but encouraged)**

```bash
# user can do this manually, or use the gstack/browse skill if available
```

- [ ] **Step 6: No final commit needed unless follow-up fixes**

---

## Acceptance criteria (mirrors the spec)

- `/dashboard` renders a year-long activity heatmap in the "Batches Scheduled" panel with the encoding described in the spec.
- Hover/focus on any cell shows a tooltip with date, planned count, and completed count.
- Clicking a cell with planned batches navigates to a filtered batches list showing exactly those batches.
- "Volume Brewed" panel renders ~52 weekly bars covering the same 365-day window, with values in the user's preferred volume unit.
- Period selector continues to drive the three `StatCardWithDelta` cards above.
- `bun lint`, `bun typecheck`, and `bun run test` all pass with zero new errors.
- Migration applies cleanly; new RPC returns expected shape on a seeded database.

---

## Out of scope (do not do as part of this plan)

- Changing the `StatCardWithDelta` row.
- Sales / Inventory dashboard tabs.
- Mobile-specific layouts beyond default horizontal scroll.
- A separate "view this week" modal or any interaction beyond click-to-filter.
- Configurable color ramp / theme switcher.
- Adjusting `get_production_trends` itself.
