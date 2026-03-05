"use client";

/**
 * Weekly Forecast Tab
 *
 * Displays three sections of 8-week forward-looking data:
 * 1. Ingredient Needs — shortfalls from `calculate_ingredient_shortfalls` RPC
 * 2. Expected Finished Goods — pipeline batches from `project_finished_goods` RPC
 * 3. Expected Revenue — order-book revenue from `project_revenue` RPC
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { dynamicRpc } from "@/services/types";
import { reportKeys, purchasingKeys } from "@/lib/query-keys";
import { formatCurrency, formatBbl } from "@/lib/format";
import {
  getCatalogTypeDisplay,
  formatQuantityWithUnit,
} from "@/lib/purchasing/demand-calculator";
import {
  Card,
  CardContent,
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
// Types
// =============================================================================

interface WeeklyTabProps {
  channelFilter: string | null;
}

/** Row from `calculate_ingredient_shortfalls` RPC */
interface ShortfallRow {
  catalog_type: string;
  catalog_name: string;
  available_qty: number;
  on_order_qty: number;
  total_required: number;
  shortfall_qty: number;
  unit: string;
  order_by_date: string;
  is_urgent: boolean;
}

/** Row from `project_finished_goods` RPC */
interface FinishedGoodRow {
  brand_name: string;
  batch_number: string;
  status: string;
  volume_bbl: number;
  ready_date: string;
  confidence: "high" | "medium" | "low";
}

/** Row from `project_revenue` RPC */
interface RevenueRow {
  week_start: string;
  channel_id: string;
  channel_name: string;
  order_count: number;
  total_units: number;
  total_revenue: number;
}

// =============================================================================
// Helpers
// =============================================================================

/** CSS class for confidence text color */
function confidenceColorClass(confidence: string): string {
  switch (confidence) {
    case "high":
      return "text-green-600 dark:text-green-400";
    case "medium":
      return "text-yellow-600 dark:text-yellow-400";
    default:
      return "text-muted-foreground";
  }
}

/** Format a date string for display as a week label */
function formatWeekLabel(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "MMM d, yyyy");
  } catch {
    return dateStr;
  }
}

// =============================================================================
// Component
// =============================================================================

export function WeeklyTab({ channelFilter }: WeeklyTabProps) {
  const supabase = createClient();

  // ---------------------------------------------------------------------------
  // Section 1: Ingredient Shortfalls
  // ---------------------------------------------------------------------------
  const {
    data: shortfalls,
    isLoading: shortfallsLoading,
    error: shortfallsError,
  } = useQuery({
    queryKey: purchasingKeys.ingredientShortfalls({ horizonWeeks: 8 }),
    queryFn: async () => {
      const { data, error } = await dynamicRpc(
        supabase,
        "calculate_ingredient_shortfalls",
        { p_horizon_weeks: 8 }
      );
      if (error) throw error;
      return (data || []) as ShortfallRow[];
    },
  });

  // ---------------------------------------------------------------------------
  // Section 2: Expected Finished Goods
  // ---------------------------------------------------------------------------
  const {
    data: finishedGoods,
    isLoading: fgLoading,
    error: fgError,
  } = useQuery({
    queryKey: reportKeys.projectedGoods(8),
    queryFn: async () => {
      const { data, error } = await dynamicRpc(
        supabase,
        "project_finished_goods",
        { p_horizon_weeks: 8 }
      );
      if (error) throw error;
      return (data || []) as FinishedGoodRow[];
    },
  });

  // ---------------------------------------------------------------------------
  // Section 3: Expected Revenue
  // ---------------------------------------------------------------------------
  const {
    data: revenueRaw,
    isLoading: revenueLoading,
    error: revenueError,
  } = useQuery({
    queryKey: reportKeys.projectedRevenue(8, false),
    queryFn: async () => {
      const { data, error } = await dynamicRpc(
        supabase,
        "project_revenue",
        { p_horizon_weeks: 8, p_include_drafts: false }
      );
      if (error) throw error;
      return (data || []) as RevenueRow[];
    },
  });

  // Client-side channel filter
  const revenueFiltered = useMemo(() => {
    if (!revenueRaw) return [];
    if (!channelFilter) return revenueRaw;
    return revenueRaw.filter((r) => r.channel_id === channelFilter);
  }, [revenueRaw, channelFilter]);

  // Group revenue rows by week with subtotals
  const revenueByWeek = useMemo(() => {
    const grouped = new Map<
      string,
      { rows: RevenueRow[]; totalOrders: number; totalUnits: number; totalRevenue: number }
    >();

    for (const row of revenueFiltered) {
      const week = row.week_start;
      if (!grouped.has(week)) {
        grouped.set(week, { rows: [], totalOrders: 0, totalUnits: 0, totalRevenue: 0 });
      }
      const group = grouped.get(week)!;
      group.rows.push(row);
      group.totalOrders += row.order_count;
      group.totalUnits += row.total_units;
      group.totalRevenue += row.total_revenue;
    }

    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [revenueFiltered]);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------
  function renderLoadingSkeleton(rows = 4) {
    return (
      <div className="space-y-2">
        {[...Array(rows)].map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  function renderError(error: unknown) {
    return (
      <div className="text-sm text-destructive py-4">
        {error instanceof Error ? error.message : "Failed to load data"}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Section 1: Ingredient Needs */}
      <Card>
        <CardHeader>
          <CardTitle>Ingredient Needs</CardTitle>
        </CardHeader>
        <CardContent>
          {shortfallsLoading ? (
            renderLoadingSkeleton()
          ) : shortfallsError ? (
            renderError(shortfallsError)
          ) : !shortfalls || shortfalls.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No shortfalls — all ingredients are covered for the next 8 weeks.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ingredient</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">On Order</TableHead>
                  <TableHead className="text-right">Required</TableHead>
                  <TableHead className="text-right">Shortfall</TableHead>
                  <TableHead>Order By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shortfalls.map((row, idx) => (
                  <TableRow
                    key={`${row.catalog_type}-${row.catalog_name}-${idx}`}
                    className={row.is_urgent ? "bg-destructive/10" : undefined}
                  >
                    <TableCell className="font-medium">
                      {row.catalog_name}
                    </TableCell>
                    <TableCell>
                      {getCatalogTypeDisplay(row.catalog_type)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatQuantityWithUnit(row.available_qty, row.unit)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatQuantityWithUnit(row.on_order_qty, row.unit)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatQuantityWithUnit(row.total_required, row.unit)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {formatQuantityWithUnit(row.shortfall_qty, row.unit)}
                    </TableCell>
                    <TableCell>
                      {formatWeekLabel(row.order_by_date)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Section 2: Expected Finished Goods */}
      <Card>
        <CardHeader>
          <CardTitle>Expected Finished Goods</CardTitle>
        </CardHeader>
        <CardContent>
          {fgLoading ? (
            renderLoadingSkeleton()
          ) : fgError ? (
            renderError(fgError)
          ) : !finishedGoods || finishedGoods.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No batches in pipeline for the next 8 weeks.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Brand</TableHead>
                  <TableHead>Batch #</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Volume (BBL)</TableHead>
                  <TableHead>Ready Date</TableHead>
                  <TableHead>Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {finishedGoods.map((row, idx) => (
                  <TableRow key={`${row.batch_number}-${idx}`}>
                    <TableCell className="font-medium">
                      {row.brand_name}
                    </TableCell>
                    <TableCell className="font-mono">
                      {row.batch_number}
                    </TableCell>
                    <TableCell className="capitalize">
                      {row.status}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatBbl(row.volume_bbl)}
                    </TableCell>
                    <TableCell>
                      {formatWeekLabel(row.ready_date)}
                    </TableCell>
                    <TableCell
                      className={`capitalize font-medium ${confidenceColorClass(row.confidence)}`}
                    >
                      {row.confidence}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Section 3: Expected Revenue */}
      <Card>
        <CardHeader>
          <CardTitle>Expected Revenue</CardTitle>
        </CardHeader>
        <CardContent>
          {revenueLoading ? (
            renderLoadingSkeleton()
          ) : revenueError ? (
            renderError(revenueError)
          ) : revenueByWeek.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No projected revenue for the next 8 weeks.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Week</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {revenueByWeek.map(([week, group]) => (
                  <>
                    {group.rows.map((row, idx) => (
                      <TableRow key={`${week}-${row.channel_id}-${idx}`}>
                        {idx === 0 ? (
                          <TableCell
                            rowSpan={group.rows.length}
                            className="font-medium align-top"
                          >
                            {formatWeekLabel(week)}
                          </TableCell>
                        ) : null}
                        <TableCell>{row.channel_name}</TableCell>
                        <TableCell className="text-right font-mono">
                          {row.order_count}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {row.total_units}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(row.total_revenue)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {group.rows.length > 1 && (
                      <TableRow
                        key={`${week}-subtotal`}
                        className="bg-muted/30 font-semibold border-t"
                      >
                        <TableCell colSpan={2} className="text-right">
                          Week Subtotal
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {group.totalOrders}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {group.totalUnits}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(group.totalRevenue)}
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
