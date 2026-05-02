"use client";

/**
 * Batch Activity Heatmap
 *
 * Year-view GitHub-style activity grid built on react-activity-calendar.
 * Background color (amber ramp) = batches planned for that day. A small
 * emerald dot indicates >=1 of those planned batches reached
 * status='completed' — a "we hit our plan" signal anchored to the planned
 * date so it never moves once placed. Click navigates to the batches list
 * filtered to that day's planned_start_date.
 *
 * Data source: get_planned_batches_by_day(p_days := 365) RPC.
 */

import { cloneElement, useMemo, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  ActivityCalendar,
  type Activity,
  type BlockElement,
} from "react-activity-calendar";
import "react-activity-calendar/tooltips.css";
import { format, parseISO, subDays } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { dashboardKeys } from "@/lib/query-keys";
import { dynamicRpc } from "@/services/types";
import { CACHE_DURATIONS, POLLING_INTERVALS } from "@/lib/constants";
import { Skeleton } from "@/components/ui/skeleton";
import { log } from "@/lib/client-logger";
import {
  bucketForCount,
  buildPlannedDateFilterHref,
} from "./heatmap-utils";

// =============================================================================
// Constants
// =============================================================================

const DAYS = 365;
const BLOCK_SIZE = 11;
const BLOCK_MARGIN = 2;
const BLOCK_RADIUS = 2;

/** Amber ramp matching Tailwind's amber palette. */
const AMBER_LIGHT = [
  "#f4f4f5", // zinc-100  (no activity)
  "#fde68a", // amber-200
  "#fbbf24", // amber-400
  "#d97706", // amber-600
  "#92400e", // amber-800
];
const AMBER_DARK = [
  "#27272a", // zinc-800  (no activity)
  "#78350f", // amber-900
  "#b45309", // amber-700
  "#fbbf24", // amber-400
  "#fde68a", // amber-200
];

const COMPLETED_DOT_COLOR = "#10b981"; // emerald-500
const COMPLETED_DOT_RADIUS = 1.5;

// =============================================================================
// Types
// =============================================================================

type PlannedByDayRow = {
  day: string;
  planned_count: number;
  completed_count: number;
};

type ActivityWithCompleted = Activity & { completed: number };

// =============================================================================
// Helpers
// =============================================================================

/**
 * Ensure the activity series spans a full year by padding the start and end
 * with zero-count entries. The library renders dates that exist in the data
 * (zero-level cells are still drawn), so we anchor the calendar to the full
 * 365-day window even when the RPC returns sparse rows.
 */
function padToYearWindow(
  rows: ActivityWithCompleted[],
): ActivityWithCompleted[] {
  const today = new Date();
  const start = format(subDays(today, DAYS - 1), "yyyy-MM-dd");
  const end = format(today, "yyyy-MM-dd");

  const byDate = new Map(rows.map((r) => [r.date, r]));
  if (!byDate.has(start)) {
    byDate.set(start, { date: start, count: 0, level: 0, completed: 0 });
  }
  if (!byDate.has(end)) {
    byDate.set(end, { date: end, count: 0, level: 0, completed: 0 });
  }
  return Array.from(byDate.values()).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
}

// =============================================================================
// Component
// =============================================================================

export function BatchActivityHeatmap() {
  const supabase = createClient();
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const colorScheme: "light" | "dark" =
    resolvedTheme === "dark" ? "dark" : "light";

  const { data: rows = [], isLoading } = useQuery({
    queryKey: dashboardKeys.heatmap.year(),
    queryFn: async (): Promise<ActivityWithCompleted[]> => {
      const { data, error } = await dynamicRpc(
        supabase,
        "get_planned_batches_by_day",
        { p_days: DAYS },
      );
      if (error) {
        log.error("Failed to fetch planned batches by day:", error);
        return [];
      }
      return ((data || []) as PlannedByDayRow[]).map((r) => ({
        date: r.day,
        count: r.planned_count,
        level: bucketForCount(r.planned_count),
        completed: r.completed_count,
      }));
    },
    refetchInterval: POLLING_INTERVALS.NORMAL,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
  });

  const data = useMemo(() => padToYearWindow(rows), [rows]);
  const hasAnyActivity = useMemo(
    () => rows.some((r) => r.count > 0 || r.completed > 0),
    [rows],
  );

  if (isLoading && rows.length === 0) {
    return <Skeleton className="h-[140px] w-full" />;
  }

  if (!hasAnyActivity) {
    return (
      <div className="text-sm text-muted-foreground">No activity yet</div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <ActivityCalendar
        data={data as Activity[]}
        theme={{ light: AMBER_LIGHT, dark: AMBER_DARK }}
        colorScheme={colorScheme}
        blockSize={BLOCK_SIZE}
        blockMargin={BLOCK_MARGIN}
        blockRadius={BLOCK_RADIUS}
        fontSize={12}
        weekStart={1}
        showWeekdayLabels
        showColorLegend
        showTotalCount
        renderBlock={(block, activity) => renderHeatmapBlock(block, activity, router)}
        labels={{
          totalCount: "{{count}} batches planned in the last year",
        }}
        tooltips={{
          activity: {
            text: (activity) => {
              const a = activity as ActivityWithCompleted;
              const dateLabel = formatTooltipDate(a.date);
              return `${dateLabel} · ${a.count} planned · ${a.completed} completed`;
            },
          },
        }}
      />
    </div>
  );
}

// =============================================================================
// Render helpers (module-scope so they get a stable identity)
// =============================================================================

function formatTooltipDate(iso: string): string {
  try {
    return format(parseISO(iso), "MMM d, yyyy");
  } catch {
    return iso;
  }
}

/**
 * Wrap the library-rendered <rect> with click navigation and overlay a small
 * emerald dot when at least one planned batch on that day completed. The dot
 * is positioned at the rect's center using its `x`/`y` props.
 */
function renderHeatmapBlock(
  block: BlockElement,
  activity: Activity,
  router: ReturnType<typeof useRouter>,
): ReactElement {
  const a = activity as ActivityWithCompleted;
  const isClickable = a.count > 0;

  const interactiveBlock = cloneElement(block, {
    onClick: isClickable
      ? () => router.push(buildPlannedDateFilterHref(a.date))
      : undefined,
    style: {
      ...(block.props.style ?? {}),
      cursor: isClickable ? "pointer" : "default",
    },
  });

  if (a.completed === 0) {
    return interactiveBlock;
  }

  // Position the dot at the rect's center. The block element carries the
  // local x/y offsets within its column <g>; the column transform handles
  // the horizontal placement.
  const cx = Number(block.props.x ?? 0) + BLOCK_SIZE / 2;
  const cy = Number(block.props.y ?? 0) + BLOCK_SIZE / 2;

  return (
    <g>
      {interactiveBlock}
      <circle
        cx={cx}
        cy={cy}
        r={COMPLETED_DOT_RADIUS}
        fill={COMPLETED_DOT_COLOR}
        pointerEvents="none"
      />
    </g>
  );
}
