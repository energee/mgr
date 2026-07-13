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

import { cloneElement, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  ActivityCalendar,
  type Activity,
  type BlockElement,
} from "react-activity-calendar";
// NOTE: `react-activity-calendar/tooltips.css` is intentionally NOT imported
// here — it lives in the dashboard layout so the styles ship with the route
// CSS. This component loads via `next/dynamic` (batch-activity-heatmap-lazy),
// and importing the CSS here would defer it to the lazy chunk, causing a
// tooltip FOUC on first render (audit F-142 review).
import { format, parseISO } from "date-fns";
import { CalendarDays } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { dashboardKeys } from "@/lib/query-keys";
import { dynamicRpc } from "@/services/types";
import { CACHE_DURATIONS, POLLING_INTERVALS } from "@/lib/constants";
import { Skeleton } from "@/components/ui/skeleton";
import { log } from "@/lib/client-logger";
import { DashboardEmpty } from "./dashboard-section";
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

type ActivityWithCompleted = Activity & { completed: number; tooltip: string };

// =============================================================================
// Component
// =============================================================================

export function BatchActivityHeatmap() {
  const supabase = createClient();
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const colorScheme: "light" | "dark" =
    resolvedTheme === "dark" ? "dark" : "light";

  const { data = [], isLoading } = useQuery({
    queryKey: dashboardKeys.heatmap.year(),
    queryFn: async (): Promise<ActivityWithCompleted[]> => {
      const { data, error } = await dynamicRpc(
        supabase,
        "get_planned_batches_by_day",
        { p_days: DAYS },
      );
      if (error) {
        // Pass the PostgrestError instance itself (not a destructured copy) so
        // client-logger's `instanceof Error` check routes this to
        // Sentry.captureException with the real message/stack (audit
        // SENTRY-7597067759 — a plain object here silently degrades to a
        // generic captureMessage with no diagnostic detail).
        log.error("Failed to fetch planned batches by day:", error);
        return [];
      }
      return ((data || []) as PlannedByDayRow[]).map((r) => ({
        date: r.day,
        count: r.planned_count,
        level: bucketForCount(r.planned_count),
        completed: r.completed_count,
        tooltip: `${formatTooltipDate(r.day)} · ${r.planned_count} planned · ${r.completed_count} completed`,
      }));
    },
    refetchInterval: POLLING_INTERVALS.NORMAL,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
  });

  if (isLoading && data.length === 0) {
    // Matches the chunk-loading fallback in batch-activity-heatmap-lazy.tsx
    // (and the rendered calendar's approximate height) to avoid CLS.
    return <Skeleton className="h-[200px] w-full rounded-lg" />;
  }

  const hasAnyActivity = data.some((r) => r.count > 0 || r.completed > 0);
  if (!hasAnyActivity) {
    return <DashboardEmpty message="No batch activity yet" icon={CalendarDays} />;
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
          activity: { text: (activity) => (activity as ActivityWithCompleted).tooltip },
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
