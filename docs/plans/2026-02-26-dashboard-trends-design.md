# Dashboard Trends & Period Comparisons Design

## Summary

Enhance all three dashboards (Production, Inventory, Sales) with time-series trend charts, period comparison delta cards, and a configurable date range selector. Currently, dashboards show only point-in-time snapshots with no historical context.

## Goals

- Show business momentum at a glance (trending up/down)
- Enable daily + weekly trend analysis across all domains
- Add period-over-period comparisons on key metrics (e.g., "+12% vs last week")
- Reusable chart infrastructure for future reports

## Non-Goals

- Materialized summary tables (use on-the-fly SQL for now)
- Export/download of chart data (future enhancement)
- Custom date range picker (fixed 7d/30d/90d presets only)

## Architecture

### Data Layer

Three new Supabase RPC functions that return daily-aggregated data for a configurable lookback window. Each function returns both the current period and the previous comparison period in a single call.

#### `get_production_trends(p_days integer)`

Returns daily rows from `batches`:
```sql
-- Output columns:
date         DATE
batches_started  INTEGER   -- batches with planned_start_date on this day
volume_bbl       NUMERIC   -- total volume_bbl for started batches
batches_completed INTEGER  -- batches that reached 'completed' on this day
```

Source: `batches` table, grouped by `planned_start_date` (for scheduled — no `actual_start_date` column exists) and `updated_at` (for completed, as an approximation). Lookback = `2 * p_days` to include comparison period.

#### `get_inventory_trends(p_days integer)`

Returns daily lot activity rows:
```sql
-- Output columns:
date                DATE
lots_created        INTEGER   -- lots received (created_at) on this day
lots_depleted       INTEGER   -- lots fully consumed (remaining_quantity <= 0) on this day
total_lot_activity  INTEGER   -- lots_created + lots_depleted
```

Source: `inventory_lots` for creation dates, `allocations` for depletion (a lot is depleted when its received quantity minus allocated quantity <= 0). Depletion date is approximated as the date of the most recent allocation against the lot. Since inventory doesn't have historical snapshots, lot activity serves as the trend metric.

#### `get_sales_trends(p_days integer)`

Returns daily rows from `orders` + `order_items`:
```sql
-- Output columns:
date           DATE
order_count    INTEGER   -- orders placed on this day
revenue        NUMERIC   -- sum of line item totals for orders on this day
fulfilled_count INTEGER  -- orders fulfilled on this day (via updated_at approximation)
```

Source: `orders` by `order_date`, with revenue from `order_items` (quantity * unit_price). `avg_order_value` is computed client-side from revenue / order_count. Lookback = `2 * p_days`.

### Component Layer

#### `TrendChart` (new: `src/components/dashboard/trend-chart.tsx`)

Reusable Recharts wrapper that renders time-series data as area or bar charts.

Props:
```typescript
interface TrendChartProps {
  data: Array<Record<string, unknown>>;
  xKey: string;           // date field name
  series: Array<{
    key: string;
    label: string;
    color?: string;        // CSS color or chart variable
  }>;
  type?: "area" | "bar";  // chart type, applies to all series (default: "area")
  height?: number;         // default 200
  formatValue?: (value: number) => string;
}
```

Design:
- Uses shadcn/ui chart config (`src/components/ui/chart.tsx`)
- Monospace numbers on axes (consistent with dashboard style)
- Muted grid lines, no outer border
- Responsive width
- Tooltip on hover showing exact values

#### `StatCardWithDelta` (new: `src/components/dashboard/stat-card-with-delta.tsx`)

Enhanced stat display showing current value and change vs previous period.

Props:
```typescript
interface StatCardWithDeltaProps {
  value: number | string;   // pre-formatted if string (e.g., "$14,200")
  label: string;
  delta?: number | null;    // percentage change (null = no delta shown)
  deltaLabel?: string;      // e.g., "vs last 7d"
  href?: string;
  className?: string;
}
```

Display:
```
  $14,200
  revenue
  +12% vs last 7d   (green text for positive, amber for negative)
```

#### `PeriodSelector` (new: `src/components/dashboard/period-selector.tsx`)

Simple inline toggle for date range selection.

Props:
```typescript
interface PeriodSelectorProps {
  className?: string;
}
```

Uncontrolled component — reads and writes period via URL search params (`?period=7`) using `useSearchParams` internally, so dashboards are linkable/shareable. Renders as a segmented control: `7d | 30d | 90d`. Companion `usePeriod()` hook reads the current period value (defaults to 30).

### Per-Dashboard Changes

#### Production Dashboard (`/dashboard`)

Additions below existing content:

1. **Period selector** in header area (right side)
2. **Delta cards row** (3 cards):
   - Batches started (current period vs previous)
   - Volume brewed (current period vs previous)
   - Batches completed (current period vs previous)
3. **Trend chart section** (2 charts side by side):
   - Left: Batches started per day (bar chart)
   - Right: Volume brewed per day (area chart)

#### Inventory Dashboard (`/dashboard/inventory`)

Additions below existing content:

1. **Period selector** in header area
2. **Delta cards row** (2 cards):
   - Lot activity (lots created this period vs last)
   - Low stock items (current count, trend direction)
3. **Trend chart section** (1 chart, full width):
   - Lot activity over time (bar chart: lots created vs lots depleted)

#### Sales Dashboard (`/dashboard/sales`)

Additions below existing content:

1. **Period selector** in header area
2. **Delta cards row** (3 cards):
   - Revenue (current vs previous period)
   - Orders placed (current vs previous period)
   - Avg order value (current vs previous period)
3. **Trend chart section** (2 charts side by side):
   - Left: Revenue per day (bar chart)
   - Right: Orders per day (area chart)

## File Changes

| File | Type | Description |
|------|------|-------------|
| `supabase/migrations/00099_dashboard_trend_functions.sql` | New | 3 RPC functions |
| `src/components/dashboard/trend-chart.tsx` | New | Reusable Recharts time-series wrapper |
| `src/components/dashboard/stat-card-with-delta.tsx` | New | Stat card with period delta |
| `src/components/dashboard/period-selector.tsx` | New | 7d/30d/90d toggle |
| `src/components/dashboard/index.ts` | Edit | Add new exports |
| `src/lib/query-keys.ts` | Edit | Add trend query key factories |
| `src/app/(app)/dashboard/page.tsx` | Edit | Add production trends + deltas |
| `src/app/(app)/dashboard/inventory/page.tsx` | Edit | Add inventory trends + deltas |
| `src/app/(app)/dashboard/sales/page.tsx` | Edit | Add sales trends + deltas |

## Migration: `00099_dashboard_trend_functions.sql`

Creates 3 functions with:
- `SECURITY INVOKER` and `SET search_path = public`
- RLS-aware (queries go through normal row-level security)
- Single parameter: `p_days INTEGER DEFAULT 30`
- Returns `2 * p_days` worth of data (current + comparison period)

## Query Keys

New additions to `src/lib/query-keys.ts`:

```typescript
export const dashboardKeys = {
  // ... existing keys ...
  trends: {
    production: (days: number) => ["dashboard", "trends", "production", days] as const,
    inventory: (days: number) => ["dashboard", "trends", "inventory", days] as const,
    sales: (days: number) => ["dashboard", "trends", "sales", days] as const,
  },
};
```

## Design Constraints

- Follow existing dashboard aesthetic: monospace numbers, muted colors, minimal chrome
- Charts use the shadcn/ui chart config already in the project
- No new npm dependencies (Recharts v3 already installed)
- Period selector uses URL search params (not local state)
- All queries use centralized query key factories
- RPC functions use `security_invoker` pattern
