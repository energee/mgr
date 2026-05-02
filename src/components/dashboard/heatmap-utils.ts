/**
 * Pure helpers for the dashboard batch activity heatmap. Framework-agnostic
 * (no React, no DOM) so they're trivially testable.
 */

import {
  eachWeekOfInterval,
  format,
  parseISO,
  startOfWeek,
} from "date-fns";
import { generateId } from "@/lib/id";

const WEEK_OPTIONS = { weekStartsOn: 1 } as const;

/** Map a planned-count to react-activity-calendar's 0..4 intensity level. */
export function bucketForCount(n: number): 0 | 1 | 2 | 3 | 4 {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 4;
}

export type WeeklyBucket = { date: string; value: number };

/**
 * Aggregate daily rows into ISO-week buckets (Monday-anchored), summing
 * `value`. Weeks within the bounds with no data are emitted as zeros so the
 * resulting series has no gaps.
 */
export function bucketWeekly(rows: WeeklyBucket[]): WeeklyBucket[] {
  if (rows.length === 0) return [];

  const sums = new Map<string, number>();
  let minDate: Date | null = null;
  let maxDate: Date | null = null;

  for (const row of rows) {
    const date = parseISO(row.date);
    const weekKey = format(startOfWeek(date, WEEK_OPTIONS), "yyyy-MM-dd");
    sums.set(weekKey, (sums.get(weekKey) ?? 0) + row.value);
    if (minDate === null || date < minDate) minDate = date;
    if (maxDate === null || date > maxDate) maxDate = date;
  }

  const weeks = eachWeekOfInterval(
    { start: minDate as Date, end: maxDate as Date },
    WEEK_OPTIONS,
  );

  return weeks.map((weekStart) => {
    const key = format(weekStart, "yyyy-MM-dd");
    return { date: key, value: sums.get(key) ?? 0 };
  });
}

type DateRangeFilter = {
  id: string;
  value: [string, string];
  variant: "dateRange";
  operator: "isBetween";
  filterId: string;
};

/**
 * Build a URL that lands on `/production/batches` with a single-day
 * daterange filter on planned_start_date pre-applied.
 */
export function buildPlannedDateFilterHref(isoDay: string): string {
  const filter: DateRangeFilter = {
    id: "planned_start_date",
    value: [isoDay, isoDay],
    variant: "dateRange",
    operator: "isBetween",
    filterId: generateId({ length: 8 }),
  };
  const params = new URLSearchParams({ filters: JSON.stringify([filter]) });
  return `/production/batches?${params.toString()}`;
}
