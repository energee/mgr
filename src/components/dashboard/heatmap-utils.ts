/**
 * Pure helpers for the dashboard batch activity heatmap.
 *
 * These functions are framework-agnostic (no React, no DOM):
 * - bucketForCount: maps a planned-batch count to the 0..4 intensity level
 *   used by react-activity-calendar.
 * - bucketWeekly: aggregates daily rows into ISO-week buckets (Monday-anchored)
 *   for the weekly-volume bar chart in the year view, zero-filling gaps.
 * - buildPlannedDateFilterHref: builds a deep link to the batches list page
 *   with a single-day daterange filter on planned_start_date pre-applied.
 */

import {
  eachWeekOfInterval,
  format,
  parseISO,
  startOfWeek,
} from "date-fns";

/** Monday-anchored week options, shared across helpers. */
const WEEK_OPTIONS = { weekStartsOn: 1 } as const;

/**
 * Map a planned-count to the 0..4 activity level used by
 * react-activity-calendar for color intensity.
 */
export function bucketForCount(n: number): 0 | 1 | 2 | 3 | 4 {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 4;
}

/**
 * Aggregate daily rows into ISO-week buckets (Monday-anchored), summing the
 * given numeric field. Weeks within the bounds with no data are emitted as
 * zeros so the resulting series has no gaps. Empty input returns an empty
 * array.
 */
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

  // Sum input rows into a map keyed by the row's week-Monday ISO date.
  const sums = new Map<string, number>();
  let minDate: Date | null = null;
  let maxDate: Date | null = null;

  for (const row of rows) {
    const date = parseISO(row[dateKey]);
    const weekStart = startOfWeek(date, WEEK_OPTIONS);
    const weekKey = format(weekStart, "yyyy-MM-dd");
    sums.set(weekKey, (sums.get(weekKey) ?? 0) + row[valueKey]);
    if (minDate === null || date < minDate) minDate = date;
    if (maxDate === null || date > maxDate) maxDate = date;
  }

  // Walk every ISO week between the first and last input row inclusive,
  // emitting zeros for weeks with no input.
  const weeks = eachWeekOfInterval(
    { start: minDate as Date, end: maxDate as Date },
    WEEK_OPTIONS,
  );

  return weeks.map((weekStart) => {
    const key = format(weekStart, "yyyy-MM-dd");
    return {
      date: key,
      [valueKey]: sums.get(key) ?? 0,
    } as { date: string } & Record<TValue, number>;
  });
}

/** Filter shape consumed by entity-data-table / nuqs on the batches list. */
type DateRangeFilter = {
  id: string;
  value: [string, string];
  variant: "dateRange";
  operator: "isBetween";
  filterId: string;
};

/**
 * Build a URL that lands on `/production/batches` with a single-day
 * daterange filter on planned_start_date pre-applied. Used by the
 * heatmap's day-cell click-through.
 */
export function buildPlannedDateFilterHref(isoDay: string): string {
  const filter: DateRangeFilter = {
    id: "planned_start_date",
    value: [isoDay, isoDay],
    variant: "dateRange",
    operator: "isBetween",
    filterId: Math.random().toString(36).slice(2, 10),
  };
  const params = new URLSearchParams({ filters: JSON.stringify([filter]) });
  return `/production/batches?${params.toString()}`;
}
