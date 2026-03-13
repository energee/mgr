# Dashboard Trends & Period Comparisons Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add time-series trend charts, period comparison delta cards, and a 7d/30d/90d period selector to all three dashboards (Production, Inventory, Sales).

**Architecture:** 3 new Supabase RPC functions return daily-aggregated data. 3 new shared dashboard components (TrendChart, StatCardWithDelta, PeriodSelector) built on existing Recharts v3 + shadcn/ui chart infrastructure. Each dashboard page gets trend charts below existing content with delta comparison cards in the stats strip.

**Tech Stack:** TypeScript, React, Recharts v3, shadcn/ui ChartContainer, Supabase RPC, date-fns, Vitest

---

### Task 1: Add trend query key factories

**Files:**
- Modify: `src/lib/query-keys.ts` (lines 237-251)
- Modify: `src/lib/__tests__/query-keys.test.ts`

**Step 1: Write the failing test**

Add to `src/lib/__tests__/query-keys.test.ts` inside the existing `dashboardKeys` describe block:

```typescript
it("trends.production returns key with days", () => {
  expect(dashboardKeys.trends.production(7)).toEqual([
    "dashboard", "trends", "production", 7,
  ]);
});

it("trends.inventory returns key with days", () => {
  expect(dashboardKeys.trends.inventory(30)).toEqual([
    "dashboard", "trends", "inventory", 30,
  ]);
});

it("trends.sales returns key with days", () => {
  expect(dashboardKeys.trends.sales(90)).toEqual([
    "dashboard", "trends", "sales", 90,
  ]);
});

it("trends keys with different days are unique", () => {
  expect(dashboardKeys.trends.production(7)).not.toEqual(
    dashboardKeys.trends.production(30)
  );
});
```

**Step 2: Run test to verify it fails**

Run: `bun vitest run src/lib/__tests__/query-keys.test.ts`
Expected: FAIL — `dashboardKeys.trends` is undefined

**Step 3: Write minimal implementation**

In `src/lib/query-keys.ts`, add `trends` to the existing `dashboardKeys` object (after the `sales` property at ~line 250):

```typescript
export const dashboardKeys = {
  all: () => ["dashboard"] as const,
  batchCounts: () => ["dashboard", "batch-counts"] as const,
  activeBatches: () => ["dashboard", "active-batches"] as const,
  vessels: () => ["dashboard", "vessels"] as const,
  lowStock: () => ["dashboard", "low-stock"] as const,
  expiringLots: () => ["dashboard", "expiring-lots"] as const,
  inventorySummary: () => ["dashboard", "inventory-summary"] as const,
  sales: {
    orderCounts: () => ["dashboard", "sales", "order-counts"] as const,
    recentOrders: () => ["dashboard", "sales", "recent-orders"] as const,
    customerRevenue: () => ["dashboard", "sales", "customer-revenue"] as const,
    productMix: () => ["dashboard", "sales", "product-mix"] as const,
  },
  trends: {
    production: (days: number) => ["dashboard", "trends", "production", days] as const,
    inventory: (days: number) => ["dashboard", "trends", "inventory", days] as const,
    sales: (days: number) => ["dashboard", "trends", "sales", days] as const,
  },
};
```

**Step 4: Run test to verify it passes**

Run: `bun vitest run src/lib/__tests__/query-keys.test.ts`
Expected: ALL PASS

**Step 5: Run typecheck**

Run: `bun tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/lib/query-keys.ts src/lib/__tests__/query-keys.test.ts
git commit -m "feat: add dashboard trend query key factories"
```

---

### Task 2: Create PeriodSelector component

**Files:**
- Create: `src/components/dashboard/period-selector.tsx`
- Modify: `src/components/dashboard/index.ts`

**Step 1: Create the component**

Create `src/components/dashboard/period-selector.tsx`:

```typescript
"use client";

/**
 * Period Selector
 *
 * Segmented toggle for selecting a date range (7d / 30d / 90d).
 * Uses URL search params so dashboard views are shareable.
 */

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { cn } from "@/lib/utils";

const PERIODS = [
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
] as const;

const DEFAULT_PERIOD = 30;

interface PeriodSelectorProps {
  /** Additional className for the container */
  className?: string;
}

/**
 * Hook to read the current period from URL search params.
 * Returns the number of days (7, 30, or 90). Defaults to 30.
 */
export function usePeriod(): number {
  const searchParams = useSearchParams();
  const raw = searchParams.get("period");
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (parsed === 7 || parsed === 30 || parsed === 90) return parsed;
  return DEFAULT_PERIOD;
}

export function PeriodSelector({ className }: PeriodSelectorProps) {
  const period = usePeriod();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setPeriod = useCallback(
    (days: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (days === DEFAULT_PERIOD) {
        params.delete("period");
      } else {
        params.set("period", String(days));
      }
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border bg-muted p-0.5 text-xs",
        className
      )}
      role="radiogroup"
      aria-label="Time period"
    >
      {PERIODS.map(({ days, label }) => (
        <button
          key={days}
          role="radio"
          aria-checked={period === days}
          onClick={() => setPeriod(days)}
          className={cn(
            "px-2.5 py-1 rounded-sm font-mono font-medium transition-colors",
            period === days
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
```

**Step 2: Update barrel export**

In `src/components/dashboard/index.ts`, add:

```typescript
export { PeriodSelector, usePeriod } from "./period-selector";
```

**Step 3: Run typecheck**

Run: `bun tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/dashboard/period-selector.tsx src/components/dashboard/index.ts
git commit -m "feat: add PeriodSelector component with URL search param state"
```

---

### Task 3: Create StatCardWithDelta component

**Files:**
- Create: `src/components/dashboard/stat-card-with-delta.tsx`
- Modify: `src/components/dashboard/index.ts`

**Step 1: Create the component**

Create `src/components/dashboard/stat-card-with-delta.tsx`:

```typescript
/**
 * Stat Card with Delta
 *
 * Displays a metric value with period-over-period comparison.
 * Shows a current value, label, and delta percentage vs previous period.
 */

import Link from "next/link";
import { cn } from "@/lib/utils";

interface StatCardWithDeltaProps {
  /** The primary value to display */
  value: string | number;
  /** Label below the value */
  label: string;
  /** Percentage change vs previous period (e.g., 12 for +12%, -5 for -5%) */
  delta?: number | null;
  /** Text shown after the delta (e.g., "vs last 7d") */
  deltaLabel?: string;
  /** Optional link wrapping the card */
  href?: string;
  /** Additional className */
  className?: string;
}

/**
 * Formats a number as a display value (e.g., 1234 -> "1,234").
 */
function formatDisplayValue(value: string | number): string {
  if (typeof value === "string") return value;
  return value.toLocaleString();
}

/**
 * Formats a delta as a signed percentage string.
 */
function formatDelta(delta: number): string {
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${Math.round(delta)}%`;
}

export function StatCardWithDelta({
  value,
  label,
  delta,
  deltaLabel,
  href,
  className,
}: StatCardWithDeltaProps) {
  const content = (
    <div
      className={cn(
        "rounded-lg border bg-card p-4 space-y-1",
        href && "hover:bg-muted/50 transition-colors",
        className
      )}
    >
      <div className="font-mono text-2xl font-semibold">
        {formatDisplayValue(value)}
      </div>
      <div className="text-sm text-muted-foreground">{label}</div>
      {delta != null && (
        <div
          className={cn(
            "text-xs font-medium font-mono",
            delta > 0 && "text-emerald-600",
            delta < 0 && "text-amber-600",
            delta === 0 && "text-muted-foreground"
          )}
        >
          {formatDelta(delta)}
          {deltaLabel && (
            <span className="text-muted-foreground font-sans font-normal ml-1">
              {deltaLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }

  return content;
}

/**
 * Calculates the percentage change between two values.
 * Returns null if the previous value is 0 (avoid division by zero).
 */
export function calculateDelta(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}
```

**Step 2: Update barrel export**

In `src/components/dashboard/index.ts`, add:

```typescript
export { StatCardWithDelta, calculateDelta } from "./stat-card-with-delta";
```

**Step 3: Run typecheck**

Run: `bun tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/dashboard/stat-card-with-delta.tsx src/components/dashboard/index.ts
git commit -m "feat: add StatCardWithDelta component with delta calculation"
```

---

### Task 4: Create TrendChart component

**Files:**
- Create: `src/components/dashboard/trend-chart.tsx`
- Modify: `src/components/dashboard/index.ts`

**Step 1: Create the component**

Create `src/components/dashboard/trend-chart.tsx`:

```typescript
"use client";

/**
 * Trend Chart
 *
 * Reusable Recharts wrapper for time-series data on dashboards.
 * Renders area or bar charts with consistent styling:
 * - Monospace numbers on axes
 * - Muted grid lines
 * - Tooltip on hover
 * - Responsive width
 */

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { format, parseISO } from "date-fns";

// =============================================================================
// Types
// =============================================================================

interface TrendSeries {
  /** Data key in the data array */
  key: string;
  /** Display label in tooltip/legend */
  label: string;
  /** CSS color or chart variable (e.g., "hsl(var(--chart-1))") */
  color?: string;
  /** Chart type: area (default) or bar */
  type?: "area" | "bar";
}

interface TrendChartProps {
  /** Array of data points, each with a date field and metric fields */
  data: Array<Record<string, unknown>>;
  /** Key in data for the x-axis date values (ISO date string) */
  xKey: string;
  /** Series definitions */
  series: TrendSeries[];
  /** Chart height in pixels (default: 200) */
  height?: number;
  /** Custom value formatter for tooltip and y-axis */
  formatValue?: (value: number) => string;
  /** Additional className for the container */
  className?: string;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
];

// =============================================================================
// Component
// =============================================================================

export function TrendChart({
  data,
  xKey,
  series,
  height = 200,
  formatValue,
  className,
}: TrendChartProps) {
  // Build ChartConfig from series
  const chartConfig = useMemo<ChartConfig>(() => {
    const config: ChartConfig = {};
    for (let i = 0; i < series.length; i++) {
      const s = series[i];
      config[s.key] = {
        label: s.label,
        color: s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      };
    }
    return config;
  }, [series]);

  // Format date labels for x-axis
  const formatDate = (value: string) => {
    try {
      return format(parseISO(value), "MMM d");
    } catch {
      return value;
    }
  };

  // Determine chart type from first series (all series in one chart should be same type)
  const chartType = series[0]?.type || "area";

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-muted-foreground"
        style={{ height }}
      >
        No data for this period
      </div>
    );
  }

  const yAxisFormatter = formatValue || ((v: number) => v.toLocaleString());

  if (chartType === "bar") {
    return (
      <figure className={className} aria-label={series.map((s) => s.label).join(", ")}>
        <ChartContainer config={chartConfig} className="w-full" style={{ height }}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey={xKey}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={formatDate}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={yAxisFormatter}
              width={48}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) => {
                    if (payload?.[0]?.payload?.[xKey]) {
                      try {
                        return format(parseISO(payload[0].payload[xKey]), "EEE, MMM d");
                      } catch {
                        return String(payload[0].payload[xKey]);
                      }
                    }
                    return "";
                  }}
                />
              }
            />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                fill={s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                radius={[2, 2, 0, 0]}
              />
            ))}
          </BarChart>
        </ChartContainer>
      </figure>
    );
  }

  // Area chart (default)
  return (
    <figure className={className} aria-label={series.map((s) => s.label).join(", ")}>
      <ChartContainer config={chartConfig} className="w-full" style={{ height }}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={xKey}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            tickFormatter={formatDate}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={yAxisFormatter}
            width={48}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  if (payload?.[0]?.payload?.[xKey]) {
                    try {
                      return format(parseISO(payload[0].payload[xKey]), "EEE, MMM d");
                    } catch {
                      return String(payload[0].payload[xKey]);
                    }
                  }
                  return "";
                }}
              />
            }
          />
          {series.map((s, i) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
              fill={s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
              fillOpacity={0.1}
              strokeWidth={2}
            />
          ))}
        </AreaChart>
      </ChartContainer>
    </figure>
  );
}
```

**Step 2: Update barrel export**

In `src/components/dashboard/index.ts`, add:

```typescript
export { TrendChart } from "./trend-chart";
```

**Step 3: Run typecheck**

Run: `bun tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/dashboard/trend-chart.tsx src/components/dashboard/index.ts
git commit -m "feat: add TrendChart component for time-series dashboard charts"
```

---

### Task 5: Create database RPC functions

**Files:**
- Create: `supabase/migrations/00099_dashboard_trend_functions.sql`

**Important context:** The migration numbering currently goes up to 00098. Use 00099. The RPC functions must use `SECURITY INVOKER` and `SET search_path = public` per project conventions. Each function returns `2 * p_days` of data — the current period and the comparison period — so the frontend can compute deltas from a single query.

**Step 1: Write the migration**

Create `supabase/migrations/00099_dashboard_trend_functions.sql`:

```sql
-- =============================================================================
-- Migration 00099: Dashboard Trend RPC Functions
-- =============================================================================
-- Creates 3 RPC functions that return daily-aggregated trend data for
-- dashboard charts. Each returns 2*p_days of data (current + comparison
-- period) so the frontend can compute deltas from a single query.
-- =============================================================================

-- =============================================================================
-- 1. Production Trends
-- =============================================================================
-- Returns daily batch starts, volume, and completions.
-- Source: batches table grouped by actual_start_date.

CREATE OR REPLACE FUNCTION get_production_trends(p_days integer DEFAULT 30)
RETURNS TABLE (
  date date,
  batches_started integer,
  volume_bbl numeric,
  batches_completed integer
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
STABLE
AS $$
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - (p_days * 2 - 1),
      CURRENT_DATE,
      '1 day'::interval
    )::date AS date
  ),
  starts AS (
    SELECT
      actual_start_date AS date,
      COUNT(*)::integer AS cnt,
      COALESCE(SUM(volume_bbl), 0) AS vol
    FROM batches
    WHERE actual_start_date >= CURRENT_DATE - (p_days * 2 - 1)
      AND actual_start_date IS NOT NULL
    GROUP BY actual_start_date
  ),
  completions AS (
    SELECT
      updated_at::date AS date,
      COUNT(*)::integer AS cnt
    FROM batches
    WHERE status = 'completed'
      AND updated_at >= CURRENT_DATE - (p_days * 2 - 1)
    GROUP BY updated_at::date
  )
  SELECT
    ds.date,
    COALESCE(s.cnt, 0)::integer AS batches_started,
    COALESCE(s.vol, 0)::numeric AS volume_bbl,
    COALESCE(c.cnt, 0)::integer AS batches_completed
  FROM date_series ds
  LEFT JOIN starts s ON s.date = ds.date
  LEFT JOIN completions c ON c.date = ds.date
  ORDER BY ds.date;
$$;

-- =============================================================================
-- 2. Inventory Trends
-- =============================================================================
-- Returns daily lot creation activity and current stock metrics.
-- Since inventory doesn't have historical snapshots, tracks lot activity
-- (lots created per day) as the trend metric.

CREATE OR REPLACE FUNCTION get_inventory_trends(p_days integer DEFAULT 30)
RETURNS TABLE (
  date date,
  lots_created integer,
  lots_depleted integer,
  total_lot_activity integer
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
STABLE
AS $$
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - (p_days * 2 - 1),
      CURRENT_DATE,
      '1 day'::interval
    )::date AS date
  ),
  created AS (
    SELECT
      created_at::date AS date,
      COUNT(*)::integer AS cnt
    FROM inventory_lots
    WHERE created_at >= CURRENT_DATE - (p_days * 2 - 1)
    GROUP BY created_at::date
  ),
  depleted AS (
    SELECT
      updated_at::date AS date,
      COUNT(*)::integer AS cnt
    FROM inventory_lots
    WHERE quantity <= 0
      AND updated_at >= CURRENT_DATE - (p_days * 2 - 1)
      AND updated_at != created_at
    GROUP BY updated_at::date
  )
  SELECT
    ds.date,
    COALESCE(cr.cnt, 0)::integer AS lots_created,
    COALESCE(dp.cnt, 0)::integer AS lots_depleted,
    (COALESCE(cr.cnt, 0) + COALESCE(dp.cnt, 0))::integer AS total_lot_activity
  FROM date_series ds
  LEFT JOIN created cr ON cr.date = ds.date
  LEFT JOIN depleted dp ON dp.date = ds.date
  ORDER BY ds.date;
$$;

-- =============================================================================
-- 3. Sales Trends
-- =============================================================================
-- Returns daily order count, revenue, and fulfillment count.
-- Revenue from order_items (quantity * unit_price).

CREATE OR REPLACE FUNCTION get_sales_trends(p_days integer DEFAULT 30)
RETURNS TABLE (
  date date,
  order_count integer,
  revenue numeric,
  fulfilled_count integer
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
STABLE
AS $$
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - (p_days * 2 - 1),
      CURRENT_DATE,
      '1 day'::interval
    )::date AS date
  ),
  daily_orders AS (
    SELECT
      o.order_date AS date,
      COUNT(*)::integer AS cnt,
      COALESCE(SUM(oi_totals.total), 0) AS rev
    FROM orders o
    LEFT JOIN (
      SELECT order_id, SUM(quantity * unit_price) AS total
      FROM order_items
      GROUP BY order_id
    ) oi_totals ON oi_totals.order_id = o.id
    WHERE o.order_date >= CURRENT_DATE - (p_days * 2 - 1)
      AND o.status != 'cancelled'
    GROUP BY o.order_date
  ),
  daily_fulfilled AS (
    SELECT
      updated_at::date AS date,
      COUNT(*)::integer AS cnt
    FROM orders
    WHERE status = 'fulfilled'
      AND updated_at >= CURRENT_DATE - (p_days * 2 - 1)
    GROUP BY updated_at::date
  )
  SELECT
    ds.date,
    COALESCE(do2.cnt, 0)::integer AS order_count,
    COALESCE(do2.rev, 0)::numeric AS revenue,
    COALESCE(df.cnt, 0)::integer AS fulfilled_count
  FROM date_series ds
  LEFT JOIN daily_orders do2 ON do2.date = ds.date
  LEFT JOIN daily_fulfilled df ON df.date = ds.date
  ORDER BY ds.date;
$$;

-- =============================================================================
-- Notify PostgREST to reload schema cache
-- =============================================================================
NOTIFY pgrst, 'reload schema';
```

**Step 2: Apply the migration to Supabase**

This must be applied to the project's Supabase database. Use the Supabase MCP `apply_migration` tool with:
- name: `dashboard_trend_functions`
- query: (the SQL above)

Check the Supabase project ID first via `list_projects`.

**Step 3: Verify the functions work**

Run test queries via `execute_sql`:

```sql
SELECT * FROM get_production_trends(7) LIMIT 3;
SELECT * FROM get_sales_trends(7) LIMIT 3;
SELECT * FROM get_inventory_trends(7) LIMIT 3;
```

Expected: rows with date, zero or non-zero metric columns

**Step 4: Commit**

```bash
git add supabase/migrations/00099_dashboard_trend_functions.sql
git commit -m "feat: add dashboard trend RPC functions (production, inventory, sales)"
```

---

### Task 6: Add trends to Production Dashboard

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

**Context:** The current production dashboard shows batch counts (stats strip), active batches table, and vessel utilization. We're adding: period selector in the header, delta cards below the stats strip, and two trend charts at the bottom.

**Step 1: Add imports and trend data fetching**

Add these imports at the top of `src/app/(app)/dashboard/page.tsx`:

```typescript
import { Suspense } from "react";
import { PeriodSelector, usePeriod } from "@/components/dashboard";
import { StatCardWithDelta, calculateDelta } from "@/components/dashboard";
import { TrendChart } from "@/components/dashboard";
```

Note: `Suspense` is needed because `usePeriod` uses `useSearchParams` which requires a Suspense boundary in Next.js App Router.

Add a new query after the existing `shortfalls` query (~line 167):

```typescript
const period = usePeriod();

const { data: productionTrends = [] } = useQuery({
  queryKey: dashboardKeys.trends.production(period),
  queryFn: async () => {
    const { data, error } = await (supabase.rpc as any)("get_production_trends", {
      p_days: period,
    });
    if (error) return [];
    return (data || []) as Array<{
      date: string;
      batches_started: number;
      volume_bbl: number;
      batches_completed: number;
    }>;
  },
  refetchInterval: 60000,
  refetchIntervalInBackground: false,
});
```

Add delta calculations after the trend query:

```typescript
// Split trend data into current and previous periods for comparison
const currentPeriodData = productionTrends.slice(period);
const previousPeriodData = productionTrends.slice(0, period);

const currentBatchesStarted = currentPeriodData.reduce((sum, d) => sum + d.batches_started, 0);
const previousBatchesStarted = previousPeriodData.reduce((sum, d) => sum + d.batches_started, 0);

const currentVolume = currentPeriodData.reduce((sum, d) => sum + Number(d.volume_bbl), 0);
const previousVolume = previousPeriodData.reduce((sum, d) => sum + Number(d.volume_bbl), 0);

const currentCompleted = currentPeriodData.reduce((sum, d) => sum + d.batches_completed, 0);
const previousCompleted = previousPeriodData.reduce((sum, d) => sum + d.batches_completed, 0);

const deltaLabel = `vs prev ${period}d`;
```

**Step 2: Add PeriodSelector to header**

In the JSX header section, add the PeriodSelector next to the "View All Batches" link. Replace the existing header `<div>`:

```tsx
<div className="flex items-baseline justify-between">
  <h1 className="text-2xl font-semibold">Production Dashboard</h1>
  <div className="flex items-center gap-4">
    <Suspense fallback={null}>
      <PeriodSelector />
    </Suspense>
    <Link
      href="/production/batches"
      className="text-sm text-muted-foreground hover:text-foreground"
    >
      View All Batches
    </Link>
  </div>
</div>
```

**Step 3: Add delta cards and trend charts**

After the closing `</div>` of the two-column layout (the `grid gap-6 lg:grid-cols-5` div), add:

```tsx
{/* Period Comparison Cards */}
<div className="grid gap-4 sm:grid-cols-3">
  <StatCardWithDelta
    value={currentBatchesStarted}
    label="batches started"
    delta={calculateDelta(currentBatchesStarted, previousBatchesStarted)}
    deltaLabel={deltaLabel}
  />
  <StatCardWithDelta
    value={`${Math.round(currentVolume * 10) / 10} BBL`}
    label="volume brewed"
    delta={calculateDelta(currentVolume, previousVolume)}
    deltaLabel={deltaLabel}
  />
  <StatCardWithDelta
    value={currentCompleted}
    label="batches completed"
    delta={calculateDelta(currentCompleted, previousCompleted)}
    deltaLabel={deltaLabel}
  />
</div>

{/* Trend Charts */}
<div className="grid gap-6 md:grid-cols-2">
  <DashboardSection title="Batches Started">
    <TrendChart
      data={currentPeriodData}
      xKey="date"
      series={[{ key: "batches_started", label: "Batches", type: "bar" }]}
    />
  </DashboardSection>
  <DashboardSection title="Volume Brewed">
    <TrendChart
      data={currentPeriodData}
      xKey="date"
      series={[{ key: "volume_bbl", label: "BBL", type: "area" }]}
      formatValue={(v) => `${v} BBL`}
    />
  </DashboardSection>
</div>
```

**Step 4: Run typecheck and lint**

Run: `bun tsc --noEmit && bun lint`
Expected: No errors

**Step 5: Commit**

```bash
git add src/app/\(app\)/dashboard/page.tsx
git commit -m "feat: add production dashboard trends with delta cards and charts"
```

---

### Task 7: Add trends to Inventory Dashboard

**Files:**
- Modify: `src/app/(app)/dashboard/inventory/page.tsx`

**Context:** The current inventory dashboard shows low stock items, expiring lots, inventory by category, and AI inventory alerts. We're adding: period selector, delta cards, and a lot activity trend chart.

**Step 1: Add imports and trend data fetching**

Add imports at the top:

```typescript
import { Suspense } from "react";
import { PeriodSelector, usePeriod } from "@/components/dashboard";
import { StatCardWithDelta, calculateDelta } from "@/components/dashboard";
import { TrendChart } from "@/components/dashboard";
```

Add after existing queries:

```typescript
const period = usePeriod();

const { data: inventoryTrends = [] } = useQuery({
  queryKey: dashboardKeys.trends.inventory(period),
  queryFn: async () => {
    const { data, error } = await (supabase.rpc as any)("get_inventory_trends", {
      p_days: period,
    });
    if (error) return [];
    return (data || []) as Array<{
      date: string;
      lots_created: number;
      lots_depleted: number;
      total_lot_activity: number;
    }>;
  },
  refetchInterval: 60000,
  refetchIntervalInBackground: false,
});

// Split into current and previous periods
const currentPeriodData = inventoryTrends.slice(period);
const previousPeriodData = inventoryTrends.slice(0, period);

const currentLotsCreated = currentPeriodData.reduce((sum, d) => sum + d.lots_created, 0);
const previousLotsCreated = previousPeriodData.reduce((sum, d) => sum + d.lots_created, 0);

const currentLotsDepleted = currentPeriodData.reduce((sum, d) => sum + d.lots_depleted, 0);
const previousLotsDepleted = previousPeriodData.reduce((sum, d) => sum + d.lots_depleted, 0);

const deltaLabel = `vs prev ${period}d`;
```

**Step 2: Add PeriodSelector to header**

Replace the existing header `<div>`:

```tsx
<div className="flex items-baseline justify-between">
  <h1 className="text-2xl font-semibold">Inventory Dashboard</h1>
  <div className="flex items-center gap-4">
    <Suspense fallback={null}>
      <PeriodSelector />
    </Suspense>
    <Link
      href="/inventory/items"
      className="text-sm text-muted-foreground hover:text-foreground"
    >
      View All Items
    </Link>
  </div>
</div>
```

**Step 3: Add delta cards and trend chart**

After the "Inventory by Category" section and before the AI alerts, add:

```tsx
{/* Period Comparison Cards */}
<div className="grid gap-4 sm:grid-cols-2">
  <StatCardWithDelta
    value={currentLotsCreated}
    label="lots received"
    delta={calculateDelta(currentLotsCreated, previousLotsCreated)}
    deltaLabel={deltaLabel}
  />
  <StatCardWithDelta
    value={currentLotsDepleted}
    label="lots consumed"
    delta={calculateDelta(currentLotsDepleted, previousLotsDepleted)}
    deltaLabel={deltaLabel}
  />
</div>

{/* Lot Activity Trend */}
<DashboardSection title="Lot Activity">
  <TrendChart
    data={currentPeriodData}
    xKey="date"
    series={[
      { key: "lots_created", label: "Received", type: "bar", color: "hsl(var(--chart-1))" },
      { key: "lots_depleted", label: "Consumed", type: "bar", color: "hsl(var(--chart-2))" },
    ]}
  />
</DashboardSection>
```

**Step 4: Run typecheck and lint**

Run: `bun tsc --noEmit && bun lint`
Expected: No errors

**Step 5: Commit**

```bash
git add src/app/\(app\)/dashboard/inventory/page.tsx
git commit -m "feat: add inventory dashboard trends with lot activity charts"
```

---

### Task 8: Add trends to Sales Dashboard

**Files:**
- Modify: `src/app/(app)/dashboard/sales/page.tsx`

**Context:** The current sales dashboard shows order pipeline, recent orders, top customers, and product mix. We're adding: period selector, delta cards, and two trend charts.

**Step 1: Add imports and trend data fetching**

Add imports at the top:

```typescript
import { Suspense } from "react";
import { PeriodSelector, usePeriod } from "@/components/dashboard";
import { StatCardWithDelta, calculateDelta } from "@/components/dashboard";
import { TrendChart } from "@/components/dashboard";
```

Add after existing queries:

```typescript
const period = usePeriod();

const { data: salesTrends = [] } = useQuery({
  queryKey: dashboardKeys.trends.sales(period),
  queryFn: async () => {
    const { data, error } = await (supabase.rpc as any)("get_sales_trends", {
      p_days: period,
    });
    if (error) return [];
    return (data || []) as Array<{
      date: string;
      order_count: number;
      revenue: number;
      fulfilled_count: number;
    }>;
  },
  refetchInterval: 60000,
  refetchIntervalInBackground: false,
});

// Split into current and previous periods
const currentPeriodData = salesTrends.slice(period);
const previousPeriodData = salesTrends.slice(0, period);

const currentRevenue = currentPeriodData.reduce((sum, d) => sum + Number(d.revenue), 0);
const previousRevenue = previousPeriodData.reduce((sum, d) => sum + Number(d.revenue), 0);

const currentOrderCount = currentPeriodData.reduce((sum, d) => sum + d.order_count, 0);
const previousOrderCount = previousPeriodData.reduce((sum, d) => sum + d.order_count, 0);

const currentAvgOrder = currentOrderCount > 0 ? currentRevenue / currentOrderCount : 0;
const previousAvgOrder = previousOrderCount > 0 ? previousRevenue / previousOrderCount : 0;

const deltaLabel = `vs prev ${period}d`;
```

**Step 2: Add PeriodSelector to header**

Replace the existing header `<div>`:

```tsx
<div className="flex items-baseline justify-between">
  <h1 className="text-2xl font-semibold">Sales Dashboard</h1>
  <div className="flex items-center gap-4">
    <Suspense fallback={null}>
      <PeriodSelector />
    </Suspense>
    <Link
      href="/sales/orders"
      className="text-sm text-muted-foreground hover:text-foreground"
    >
      View All Orders
    </Link>
  </div>
</div>
```

**Step 3: Add delta cards and trend charts**

After the "Product Mix" section (the last `DashboardSection` in the JSX), add:

```tsx
{/* Period Comparison Cards */}
<div className="grid gap-4 sm:grid-cols-3">
  <StatCardWithDelta
    value={formatCurrency(currentRevenue)}
    label="revenue"
    delta={calculateDelta(currentRevenue, previousRevenue)}
    deltaLabel={deltaLabel}
  />
  <StatCardWithDelta
    value={currentOrderCount}
    label="orders placed"
    delta={calculateDelta(currentOrderCount, previousOrderCount)}
    deltaLabel={deltaLabel}
  />
  <StatCardWithDelta
    value={currentAvgOrder > 0 ? formatCurrency(currentAvgOrder) : "—"}
    label="avg order value"
    delta={calculateDelta(currentAvgOrder, previousAvgOrder)}
    deltaLabel={deltaLabel}
  />
</div>

{/* Trend Charts */}
<div className="grid gap-6 md:grid-cols-2">
  <DashboardSection title="Revenue">
    <TrendChart
      data={currentPeriodData}
      xKey="date"
      series={[{ key: "revenue", label: "Revenue", type: "bar" }]}
      formatValue={(v) => formatCurrency(v)}
    />
  </DashboardSection>
  <DashboardSection title="Orders">
    <TrendChart
      data={currentPeriodData}
      xKey="date"
      series={[{ key: "order_count", label: "Orders", type: "area" }]}
    />
  </DashboardSection>
</div>
```

Note: `formatCurrency` already exists in this file's helper functions.

**Step 4: Run typecheck and lint**

Run: `bun tsc --noEmit && bun lint`
Expected: No errors

**Step 5: Commit**

```bash
git add src/app/\(app\)/dashboard/sales/page.tsx
git commit -m "feat: add sales dashboard trends with revenue and order charts"
```

---

### Task 9: Final validation

**Files:** None (validation only)

**Step 1: Run full test suite**

Run: `bun vitest run`
Expected: All tests pass

**Step 2: Run full type check**

Run: `bun tsc --noEmit`
Expected: No errors

**Step 3: Run linter**

Run: `bun lint`
Expected: No errors (or only pre-existing warnings)

**Step 4: Run build**

Run: `bun build`
Expected: Build succeeds

**Step 5: Manual smoke test**

Open the app in a browser and verify:
1. `/dashboard` — period selector visible, trend charts render, delta cards show values
2. `/dashboard/inventory` — period selector visible, lot activity chart renders
3. `/dashboard/sales` — period selector visible, revenue/order charts render
4. Switching period (7d/30d/90d) updates charts and delta cards
5. URL updates with `?period=7` or `?period=90` when selecting non-default period
6. Empty state ("No data for this period") shows gracefully when no data exists

---

### Summary

| Task | Description | Dependencies |
|------|-------------|-------------|
| 1 | Query key factories | None |
| 2 | PeriodSelector component | None |
| 3 | StatCardWithDelta component | None |
| 4 | TrendChart component | None |
| 5 | Database RPC functions | None |
| 6 | Production dashboard integration | Tasks 1-5 |
| 7 | Inventory dashboard integration | Tasks 1-5 |
| 8 | Sales dashboard integration | Tasks 1-5 |
| 9 | Final validation | Tasks 6-8 |

**Parallelism:** Tasks 1-5 can all run in parallel. Tasks 6-8 can run in parallel after 1-5 complete. Task 9 runs last.
