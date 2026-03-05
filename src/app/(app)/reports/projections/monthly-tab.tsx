"use client";

/**
 * Monthly Outlook Tab
 *
 * Displays a 6-month forward view across three sections:
 *   1. Expected Finished Goods by Month — bar chart + table grouped by month
 *   2. Revenue Projections by Month — stacked bar chart by channel + table
 *   3. Ingredient Needs Summary — shortfall cards + table
 *
 * Data is fetched from three Supabase RPCs:
 *   - project_finished_goods (26 weeks)
 *   - project_revenue (26 weeks, include drafts)
 *   - calculate_ingredient_shortfalls (26 weeks)
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth } from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import { dynamicRpc } from "@/services/types";
import { reportKeys, purchasingKeys } from "@/lib/query-keys";
import { formatCurrency } from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

// =============================================================================
// Props
// =============================================================================

interface MonthlyTabProps {
  channelFilter: string | null;
}

// =============================================================================
// Types — RPC row shapes
// =============================================================================

/** Row returned by `project_finished_goods` RPC. */
interface ProjectedGoodsRow {
  brand_id: string;
  brand_name: string;
  batch_id: string;
  batch_number: string;
  batch_status: string;
  volume_bbl: number;
  estimated_ready_date: string;
  projection_week: string;
  confidence: string;
}

/** Row returned by `project_revenue` RPC. */
interface ProjectedRevenueRow {
  projection_week: string;
  channel_id: string;
  channel_name: string;
  order_count: number;
  total_units: number;
  total_revenue: number;
  includes_drafts: boolean;
}

/** Row returned by `calculate_ingredient_shortfalls` RPC. */
interface ShortfallRow {
  catalog_type: string;
  catalog_id: string;
  catalog_name: string;
  total_required: number;
  available_qty: number;
  shortfall_qty: number;
  unit: string;
  required_by_date: string;
  order_by_date: string;
  lead_time_days: number;
  preferred_supplier_id: string | null;
  preferred_supplier_name: string | null;
  min_order_qty: number | null;
  unit_price: number | null;
  is_urgent: boolean;
  batch_count: number;
  on_order_qty: number;
}

// =============================================================================
// Chart colours
// =============================================================================

/** Muted colour palette for confidence levels. */
const CONFIDENCE_COLORS: Record<string, string> = {
  high: "hsl(var(--chart-1))",
  medium: "hsl(var(--chart-2))",
  low: "hsl(var(--chart-3))",
};

/** Palette for stacked channel bars. */
const CHANNEL_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

// =============================================================================
// Helpers
// =============================================================================

/** Format a month key (ISO date string) to a short label like "Mar 2026". */
function formatMonthLabel(monthKey: string): string {
  return format(new Date(monthKey), "MMM yyyy");
}

// =============================================================================
// Component
// =============================================================================

export function MonthlyTab({ channelFilter }: MonthlyTabProps) {
  const supabase = createClient();

  // ---------------------------------------------------------------------------
  // Data Fetching
  // ---------------------------------------------------------------------------

  const {
    data: goodsData,
    isLoading: goodsLoading,
  } = useQuery({
    queryKey: reportKeys.projectedGoods(26),
    queryFn: async () => {
      const { data, error } = await dynamicRpc(
        supabase,
        "project_finished_goods",
        { p_horizon_weeks: 26 },
      );
      if (error) throw error;
      return (data ?? []) as ProjectedGoodsRow[];
    },
  });

  const {
    data: revenueData,
    isLoading: revenueLoading,
  } = useQuery({
    queryKey: reportKeys.projectedRevenue(26, true),
    queryFn: async () => {
      const { data, error } = await dynamicRpc(
        supabase,
        "project_revenue",
        { p_horizon_weeks: 26, p_include_drafts: true },
      );
      if (error) throw error;
      return (data ?? []) as ProjectedRevenueRow[];
    },
  });

  const {
    data: shortfallData,
    isLoading: shortfallLoading,
  } = useQuery({
    queryKey: purchasingKeys.ingredientShortfalls({ horizonWeeks: 26 }),
    queryFn: async () => {
      const { data, error } = await dynamicRpc(
        supabase,
        "calculate_ingredient_shortfalls",
        { p_horizon_weeks: 26 },
      );
      if (error) throw error;
      return (data ?? []) as ShortfallRow[];
    },
  });

  // ---------------------------------------------------------------------------
  // Section 1: Finished Goods by Month
  // ---------------------------------------------------------------------------

  /** Aggregate projected goods rows into monthly buckets. */
  const goodsByMonth = useMemo(() => {
    if (!goodsData) return [];
    const map = new Map<
      string,
      { month: string; batches: number; totalBbl: number; confidenceSum: number }
    >();

    for (const row of goodsData) {
      const monthKey = format(
        startOfMonth(new Date(row.estimated_ready_date)),
        "yyyy-MM-dd",
      );
      const existing = map.get(monthKey) ?? {
        month: monthKey,
        batches: 0,
        totalBbl: 0,
        confidenceSum: 0,
      };
      existing.batches += 1;
      existing.totalBbl += Number(row.volume_bbl) || 0;
      // Map confidence to numeric for averaging: high=3, medium=2, low=1
      existing.confidenceSum +=
        row.confidence === "high" ? 3 : row.confidence === "medium" ? 2 : 1;
      map.set(monthKey, existing);
    }

    return Array.from(map.values())
      .map((m) => ({
        ...m,
        avgConfidence:
          m.batches > 0
            ? m.confidenceSum / m.batches >= 2.5
              ? "high"
              : m.confidenceSum / m.batches >= 1.5
                ? "medium"
                : "low"
            : "low",
        label: formatMonthLabel(m.month),
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [goodsData]);

  // ---------------------------------------------------------------------------
  // Section 2: Revenue Projections by Month
  // ---------------------------------------------------------------------------

  /** All distinct channels in the revenue data. */
  const channels = useMemo(() => {
    if (!revenueData) return [];
    const seen = new Map<string, string>();
    for (const row of revenueData) {
      if (!seen.has(row.channel_id)) {
        seen.set(row.channel_id, row.channel_name);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [revenueData]);

  /** Revenue data filtered by selected channel (client-side). */
  const filteredRevenue = useMemo(() => {
    if (!revenueData) return [];
    if (!channelFilter) return revenueData;
    return revenueData.filter((r) => r.channel_id === channelFilter);
  }, [revenueData, channelFilter]);

  /** Revenue grouped by month with per-channel breakdown for stacked chart. */
  const revenueByMonth = useMemo(() => {
    if (!filteredRevenue.length) return [];

    // Build a map: monthKey -> { channelName -> revenue }
    const map = new Map<string, Record<string, number>>();

    for (const row of filteredRevenue) {
      const monthKey = format(
        startOfMonth(new Date(row.projection_week)),
        "yyyy-MM-dd",
      );
      const existing = map.get(monthKey) ?? {};
      existing[row.channel_name] =
        (existing[row.channel_name] ?? 0) + Number(row.total_revenue);
      map.set(monthKey, existing);
    }

    return Array.from(map.entries())
      .map(([month, channelRevenues]) => ({
        month,
        label: formatMonthLabel(month),
        ...channelRevenues,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [filteredRevenue]);

  /** Revenue table rows: Month x Channel detail. */
  const revenueTableRows = useMemo(() => {
    if (!filteredRevenue.length) return [];
    const map = new Map<
      string,
      {
        month: string;
        channel: string;
        orders: number;
        units: number;
        revenue: number;
        hasDrafts: boolean;
      }
    >();

    for (const row of filteredRevenue) {
      const monthKey = format(
        startOfMonth(new Date(row.projection_week)),
        "yyyy-MM-dd",
      );
      const key = `${monthKey}|${row.channel_name}`;
      const existing = map.get(key) ?? {
        month: monthKey,
        channel: row.channel_name,
        orders: 0,
        units: 0,
        revenue: 0,
        hasDrafts: false,
      };
      existing.orders += row.order_count;
      existing.units += Number(row.total_units);
      existing.revenue += Number(row.total_revenue);
      if (row.includes_drafts) existing.hasDrafts = true;
      map.set(key, existing);
    }

    return Array.from(map.values()).sort((a, b) =>
      a.month === b.month
        ? b.revenue - a.revenue
        : a.month.localeCompare(b.month),
    );
  }, [filteredRevenue]);

  /** Channel names relevant after filtering, used for stacked chart bars. */
  const activeChannels = useMemo(() => {
    if (channelFilter) {
      const match = channels.find((c) => c.id === channelFilter);
      return match ? [match.name] : [];
    }
    return channels.map((c) => c.name);
  }, [channels, channelFilter]);

  // ---------------------------------------------------------------------------
  // Section 3: Ingredient Shortfall Summary
  // ---------------------------------------------------------------------------

  const shortfallSummary = useMemo(() => {
    if (!shortfallData) return { total: 0, urgent: 0, estimatedCost: 0 };
    return {
      total: shortfallData.length,
      urgent: shortfallData.filter((s) => s.is_urgent).length,
      estimatedCost: shortfallData.reduce(
        (sum, s) =>
          sum + (s.unit_price ? s.shortfall_qty * s.unit_price : 0),
        0,
      ),
    };
  }, [shortfallData]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* ================================================================== */}
      {/* Section 1: Expected Finished Goods by Month                        */}
      {/* ================================================================== */}
      <Card>
        <CardHeader>
          <CardTitle>Expected Finished Goods by Month</CardTitle>
          <CardDescription>
            Projected volume from batches in the production pipeline (26-week
            outlook)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {goodsLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : goodsByMonth.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              No projected finished goods in the next 6 months
            </p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={goodsByMonth}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" fontSize={12} />
                  <YAxis
                    fontSize={12}
                    tickFormatter={(v: number) => `${v} BBL`}
                  />
                  <Tooltip
                    formatter={(value) => [
                      `${Number(value).toFixed(2)} BBL`,
                      "Volume",
                    ]}
                  />
                  <Legend />
                  <Bar dataKey="totalBbl" name="Volume (BBL)" radius={[4, 4, 0, 0]}>
                    {goodsByMonth.map((entry) => (
                      <Cell
                        key={entry.month}
                        fill={CONFIDENCE_COLORS[entry.avgConfidence] ?? CONFIDENCE_COLORS.low}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              <Table className="mt-4">
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Batches</TableHead>
                    <TableHead className="text-right">Total Volume BBL</TableHead>
                    <TableHead className="text-right">Avg Confidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {goodsByMonth.map((row) => (
                    <TableRow key={row.month}>
                      <TableCell className="font-medium">{row.label}</TableCell>
                      <TableCell className="text-right font-mono">
                        {row.batches}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {row.totalBbl.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right capitalize">
                        {row.avgConfidence}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      {/* ================================================================== */}
      {/* Section 2: Revenue Projections by Month                            */}
      {/* ================================================================== */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue Projections by Month</CardTitle>
          <CardDescription>
            Projected order revenue by sales channel (includes draft orders)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {revenueLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : revenueByMonth.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              No projected revenue in the next 6 months
            </p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={revenueByMonth}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" fontSize={12} />
                  <YAxis
                    fontSize={12}
                    tickFormatter={(v: number) => formatCurrency(v)}
                  />
                  <Tooltip
                    formatter={(value, name) => [
                      formatCurrency(Number(value)),
                      String(name),
                    ]}
                  />
                  <Legend />
                  {activeChannels.map((channel, idx) => (
                    <Bar
                      key={channel}
                      dataKey={channel}
                      name={channel}
                      stackId="stack"
                      fill={CHANNEL_COLORS[idx % CHANNEL_COLORS.length]}
                      radius={
                        idx === activeChannels.length - 1
                          ? [4, 4, 0, 0]
                          : [0, 0, 0, 0]
                      }
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>

              <Table className="mt-4">
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Has Drafts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revenueTableRows.map((row, idx) => (
                    <TableRow key={`${row.month}-${row.channel}-${idx}`}>
                      <TableCell className="font-medium">
                        {formatMonthLabel(row.month)}
                      </TableCell>
                      <TableCell>{row.channel}</TableCell>
                      <TableCell className="text-right font-mono">
                        {row.orders}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {row.units.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(row.revenue)}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.hasDrafts ? "Yes" : "No"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      {/* ================================================================== */}
      {/* Section 3: Ingredient Needs Summary                                */}
      {/* ================================================================== */}
      <Card>
        <CardHeader>
          <CardTitle>Ingredient Needs Summary</CardTitle>
          <CardDescription>
            Shortfalls requiring purchase orders over the next 26 weeks
          </CardDescription>
        </CardHeader>
        <CardContent>
          {shortfallLoading ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-muted-foreground">
                      Total Shortfall Items
                    </p>
                    <p className="text-2xl font-bold font-mono">
                      {shortfallSummary.total}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-muted-foreground">
                      Urgent Items
                    </p>
                    <p className="text-2xl font-bold font-mono text-destructive">
                      {shortfallSummary.urgent}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-muted-foreground">
                      Total Estimated Cost
                    </p>
                    <p className="text-2xl font-bold font-mono">
                      {formatCurrency(shortfallSummary.estimatedCost)}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Shortfall table */}
              {shortfallData && shortfallData.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ingredient</TableHead>
                      <TableHead className="text-right">Required</TableHead>
                      <TableHead className="text-right">Shortfall</TableHead>
                      <TableHead className="text-right">Order By Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shortfallData.map((row) => (
                      <TableRow key={row.catalog_id}>
                        <TableCell className="font-medium">
                          {row.catalog_name}
                          <span className="ml-2 text-xs text-muted-foreground capitalize">
                            ({row.catalog_type})
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {row.total_required.toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })}{" "}
                          {row.unit}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {row.shortfall_qty.toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })}{" "}
                          {row.unit}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.order_by_date
                            ? format(new Date(row.order_by_date), "MMM d, yyyy")
                            : "--"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-center py-8 text-muted-foreground">
                  No ingredient shortfalls in the next 26 weeks
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
