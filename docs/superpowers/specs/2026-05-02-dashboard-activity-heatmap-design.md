# Dashboard Activity Heatmap (Year View)

**Date:** 2026-05-02
**Status:** Approved, ready for implementation plan
**Scope:** Replace the daily bar chart in the "Batches Scheduled" section of `/dashboard` with a GitHub-style year-view activity heatmap, and convert the adjacent "Volume Brewed" line chart to weekly bars over the same year window.

---

## Motivation

The current "Batches Scheduled" panel renders daily `batches_started` as a bar chart whose width depends on the period selector (7/30/90 days). For a brewery, this view is information-sparse: most days have zero batches, and short windows obscure seasonality. A GitHub-style year heatmap surfaces brewing rhythm at a glance — when the brewery is busy, idle, or behind schedule — and pairs cleanly with a year-of-weekly-volume chart for total throughput.

The period selector at the top of the dashboard remains useful for the three `StatCardWithDelta` cards (period-over-period comparison) but stops driving the two trend panels in this row. Those become fixed-year views.

---

## What changes

### Panel 1: "Batches Scheduled" — year heatmap

Replaces the existing `<TrendChart type="bar" />` at `src/app/(app)/dashboard/page.tsx:513-520`.

**Time range:** 365 days ending today.

**Layout:** GitHub classic orientation — 7 rows (days of week, Sunday top → Saturday bottom), ~53 columns (weeks, oldest left → newest right). Rendered as a grid of 11×11px squares with 2px gaps and `rounded-[2px]` corners.

**Labels:**
- Day-of-week labels on the left, only `Mon` / `Wed` / `Fri` (alternating rows, GitHub convention).
- Month labels above the grid (`Jan`, `Feb`, …) positioned at the column where each new month begins.

**Encoding (two metrics per cell):**
- **Background color** = number of batches with `planned_start_date` on this day. Amber ramp, fixed thresholds:
  - 0 → `bg-muted` (low contrast, reads as "no activity")
  - 1 → `bg-amber-200 dark:bg-amber-900`
  - 2 → `bg-amber-400 dark:bg-amber-700`
  - 3 → `bg-amber-600 dark:bg-amber-500`
  - 4+ → `bg-amber-800 dark:bg-amber-300`
- **Completion dot** — small `~3px` filled circle centered in the cell when ≥1 batch was completed on this day. Color: `bg-emerald-500`. A single dot regardless of completion count; tooltip shows the actual number.

**Interaction:**
- Hover (or focus): tooltip shows `Mar 12, 2026 · 3 planned · 1 completed`. Use existing tooltip primitives from `src/components/ui/tooltip.tsx`.
- Click on a cell with ≥1 planned batch: navigate to `/production/batches?planned_start_date=YYYY-MM-DD`.
- Click on a fully-empty cell: no-op.
- Cells are buttons (or `<a>`) for keyboard navigability; `aria-label` mirrors the tooltip text.

**Legend:** Bottom-right of the panel:
- `Less □ □ ▣ ▣ ▪ More` — five swatches showing the amber ramp.
- Separator + `● completed` — the emerald dot indicator.

**Empty / sparse states:** Cells outside the 365-day window (e.g., the trailing edge of the most recent week if it isn't full) render as fully transparent placeholders so the grid stays rectangular.

### Panel 2: "Volume Brewed" — year weekly bars

Replaces the existing `<TrendChart />` at `src/app/(app)/dashboard/page.tsx:521-528`.

**Time range:** Same 365-day window as the heatmap, bucketed into ISO weeks (Monday-anchored).

**Rendering:** Reuse `<TrendChart type="bar" />` with weekly-bucketed data (~52 bars). Each bar height = sum of `volume_bbl` for that week, converted via `convertVolume` to the user's preferred `volumeUnit` (existing `useVolumeUnit` hook).

**X-axis labels:** Month abbreviations rendered at the bar that begins each new month (consistent with the heatmap's month labels above).

**Tooltip:** `Week of Mar 9, 2026 · 12.4 BBL` (or user's unit).

**Empty bars:** Weeks with zero volume render as 0-height bars (no gap), so the timeline reads continuously.

---

## Data layer

### New RPC: `get_planned_batches_by_day`

Existing `get_production_trends` returns `batches_started` (count by `actual_start_date`), which is option B2 ("what happened"). The heatmap needs B1 ("what was scheduled") — count by `planned_start_date`. Adding this as a new RPC keeps the query single, indexable, and RLS-respecting.

**Signature:**
```sql
CREATE FUNCTION get_planned_batches_by_day(p_days int DEFAULT 365)
RETURNS TABLE (
  date date,
  planned_count int,
  completed_count int
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
  -- Generate one row per day in the window; left-join to batches grouped by
  -- planned_start_date and to batches grouped by completion date.
$$;
```

Returns one row per day in the window (`generate_series` over `current_date - p_days .. current_date`), so the client gets a dense array even on idle days.

**Migration filename:** `supabase/migrations/00156_get_planned_batches_by_day.sql`. (Confirm `00156` is unused at implementation time; if a parallel branch claimed it, bump.)

`_schema_registry` does not need an entry — RPCs are not tracked there.

### Reusing `get_production_trends` for the volume chart

The weekly volume chart can either:

1. Call existing `get_production_trends` with `p_days: 365` and bucket client-side into ISO weeks.
2. Add a `get_weekly_volume_trends` RPC that buckets server-side.

**Decision:** Option 1 (client-side bucket). The dataset is small (365 rows × ~5 fields ≈ 15KB), and a `Map<ISO-week, sum>` reduce is trivial. Avoids a second migration. Verify `get_production_trends` accepts `p_days: 365` cleanly; if it caps internally, raise the cap as a one-line migration.

### Query keys

Add to `src/lib/query-keys.ts`:

```ts
dashboardKeys = {
  // … existing
  heatmap: {
    year: () => ["dashboard", "heatmap", "year"] as const,
  },
  trends: {
    // … existing
    weeklyVolume: () => ["dashboard", "trends", "weekly-volume"] as const,
  },
};
```

Both year-scoped queries are independent of the period selector. Stale time matches existing trend queries (~60s).

---

## Click-filter wiring

`src/entities/batch.tsx` currently exposes two `listFilters`: `status` (multiselect) and `current_vessel_name` (select). It has no date filter, and `entity-list.tsx` doesn't yet have a daterange filter input type.

Two paths:

**Option A (chosen):** Add a `planned_start_date` filter of a new `daterange` type to entity-list. Generally useful (planning views, scheduling reports). Larger lift — touches the universal entity-list component and adds a `DateRangePicker` filter input.

**Option B (alternative):** Add a single-day URL param (`?planned_start_date=YYYY-MM-DD`) read by entity-list as an exact-match filter, no UI control. Smaller, but invisible from the list page.

**Decision:** **Option A.** A daterange filter on `planned_start_date` is broadly useful beyond this dashboard click; the heatmap click sets `planned_start_date_from=YYYY-MM-DD&planned_start_date_to=YYYY-MM-DD` (same day on both ends) so the existing list URL grammar remains uniform.

If the implementation plan finds the daterange-filter scope balloons (e.g., entity-list refactor required), we fall back to Option B and revisit the daterange filter as a follow-up.

---

## Files affected

| File | Change |
|---|---|
| `src/app/(app)/dashboard/page.tsx` | Replace `<TrendChart />` for "Batches Scheduled" with `<BatchActivityHeatmap />`; reconfigure "Volume Brewed" `<TrendChart />` to weekly buckets over 365 days. Move year-scoped queries out from under `usePeriod()`. |
| `src/components/dashboard/batch-activity-heatmap.tsx` | **New.** The heatmap component. |
| `src/components/dashboard/index.ts` | Export `BatchActivityHeatmap`. |
| `src/lib/query-keys.ts` | Add `dashboardKeys.heatmap.year()` and `dashboardKeys.trends.weeklyVolume()`. |
| `supabase/migrations/00156_get_planned_batches_by_day.sql` | **New.** RPC for daily planned + completed counts. |
| `src/entities/batch.tsx` | Add `planned_start_date` daterange filter to `listFilters`. |
| `src/components/universal/entity-list.tsx` (and supporting filter input components) | Add `daterange` filter input type if not already supported. |

No changes to `_schema_registry`, no changes to existing migrations, no changes to other dashboard panels.

---

## Out of scope

- Changes to the three `StatCardWithDelta` cards above the panels — they continue to use `usePeriod()` for period-over-period comparison.
- Sales / Inventory dashboard tabs.
- Mobile-specific layout — the heatmap will use horizontal overflow / scroll on small screens (default browser behavior is fine for v1).
- Historical drilldown beyond click-to-list (e.g., a "view this week" modal).
- Configurable color ramp / theme switcher.
- Showing brews that started but were cancelled.

---

## Open questions for implementation

1. Does `get_production_trends` accept `p_days: 365` without server-side caps? Verify in implementation; raise cap if needed.
2. Does `entity-list.tsx` already have a daterange filter input, or does this spec need to add one? Verify in implementation; if absent, add one (small additional task) or fall back to Option B above.
3. Exact migration number — confirm `00156` is unused on the working branch at implementation time.

---

## Acceptance criteria

- `/dashboard` renders a year-long activity heatmap in the "Batches Scheduled" panel with the encoding described above.
- Hover/focus on any cell shows a tooltip with date, planned count, and completed count.
- Clicking a cell with planned batches navigates to a filtered batches list showing exactly those batches.
- "Volume Brewed" panel renders ~52 weekly bars covering the same 365-day window, with values in the user's preferred volume unit.
- Period selector continues to drive the three `StatCardWithDelta` cards above.
- `bun lint` and `bun typecheck` pass with zero new errors.
- Migration applies cleanly; new RPC returns expected shape on a seeded database.
