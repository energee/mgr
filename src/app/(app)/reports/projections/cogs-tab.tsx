"use client";

/**
 * COGS Tab Component
 *
 * Displays cost-of-goods-sold analysis with four sections:
 * 1. Summary cards — total COGS, avg COGS/BBL, total revenue, gross margin %
 * 2. Batch cost table — per-batch ingredient cost breakdown by category
 * 3. Channel margin table — revenue vs COGS by sales channel
 * 4. Cost breakdown chart — stacked bar chart of costs by batch (optional)
 *
 * Data sources:
 * - `cogs_by_period` RPC for batch-level ingredient costs
 * - `margin_by_channel` RPC for channel-level margin analysis
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicRpc } from "@/services/types";
import { reportKeys } from "@/lib/query-keys";
import { formatCurrency, formatBbl } from "@/lib/format";
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
import { Badge } from "@/components/ui/badge";
import { DollarSign, TrendingUp, BarChart3, Percent } from "lucide-react";

// =============================================================================
// Types
// =============================================================================

interface COGSTabProps {
  dateRange: { from: string; to: string };
  channelFilter: string | null;
}

/** Row returned by the cogs_by_period RPC */
interface COGSRow {
  batch_id: string;
  batch_number: string;
  recipe_name: string | null;
  brand_name: string | null;
  volume_bbl: number | null;
  malt_cost: number;
  hops_cost: number;
  yeast_cost: number;
  adjunct_cost: number;
  other_cost: number;
  total_ingredient_cost: number;
  landed_cost: number | null;
  cost_per_bbl: number | null;
  has_allocation_data: boolean;
}

/** Row returned by the margin_by_channel RPC */
interface MarginRow {
  channel_name: string;
  order_count: number;
  unit_count: number;
  total_revenue: number;
  total_cogs: number;
  margin: number;
  margin_pct: number;
}

// =============================================================================
// Component
// =============================================================================

export function COGSTab({ dateRange, channelFilter }: COGSTabProps) {
  const supabase = createClient();

  // ---------------------------------------------------------------------------
  // Data: COGS by period (batch cost breakdown)
  // ---------------------------------------------------------------------------
  const {
    data: cogsData,
    isLoading: cogsLoading,
    error: cogsError,
  } = useQuery({
    queryKey: reportKeys.cogs(dateRange),
    queryFn: async () => {
      const { data, error } = await dynamicRpc(supabase, "cogs_by_period", {
        p_start_date: dateRange.from,
        p_end_date: dateRange.to,
      });
      if (error) throw error;
      return (data ?? []) as COGSRow[];
    },
  });

  // ---------------------------------------------------------------------------
  // Data: Margin by channel
  // ---------------------------------------------------------------------------
  const {
    data: marginData,
    isLoading: marginLoading,
    error: marginError,
  } = useQuery({
    queryKey: reportKeys.marginByChannel(dateRange),
    queryFn: async () => {
      const { data, error } = await dynamicRpc(
        supabase,
        "margin_by_channel",
        {
          p_start_date: dateRange.from,
          p_end_date: dateRange.to,
        }
      );
      if (error) throw error;
      return (data ?? []) as MarginRow[];
    },
  });

  // ---------------------------------------------------------------------------
  // Derived: filtered margin rows
  // ---------------------------------------------------------------------------
  const filteredMargin = useMemo(() => {
    if (!marginData) return [];
    if (!channelFilter) return marginData;
    return marginData.filter((r) => r.channel_name === channelFilter);
  }, [marginData, channelFilter]);

  // ---------------------------------------------------------------------------
  // Summary calculations
  // ---------------------------------------------------------------------------
  const summary = useMemo(() => {
    const totalCogs = (cogsData ?? []).reduce(
      (sum, r) => sum + r.total_ingredient_cost,
      0
    );
    const totalVolume = (cogsData ?? []).reduce(
      (sum, r) => sum + (r.volume_bbl ?? 0),
      0
    );
    const avgCogsPerBbl = totalVolume > 0 ? totalCogs / totalVolume : 0;

    const totalRevenue = filteredMargin.reduce(
      (sum, r) => sum + r.total_revenue,
      0
    );
    const totalMarginCogs = filteredMargin.reduce(
      (sum, r) => sum + r.total_cogs,
      0
    );
    const grossMarginPct =
      totalRevenue > 0
        ? ((totalRevenue - totalMarginCogs) / totalRevenue) * 100
        : 0;

    return { totalCogs, avgCogsPerBbl, totalRevenue, grossMarginPct };
  }, [cogsData, filteredMargin]);

  // ---------------------------------------------------------------------------
  // Sorted COGS data (by batch_number ascending)
  // ---------------------------------------------------------------------------
  const sortedCogs = useMemo(() => {
    if (!cogsData) return [];
    return [...cogsData].sort((a, b) =>
      a.batch_number.localeCompare(b.batch_number, undefined, { numeric: true })
    );
  }, [cogsData]);

  const isLoading = cogsLoading || marginLoading;
  const error = cogsError || marginError;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Error */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">
              {error instanceof Error
                ? error.message
                : "Failed to load COGS data"}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Section 1: Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <DollarSign className="h-4 w-4" />
              Total COGS
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold font-mono">
                {formatCurrency(summary.totalCogs)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-4 w-4" />
              Avg COGS / BBL
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold font-mono">
                {formatCurrency(summary.avgCogsPerBbl)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <BarChart3 className="h-4 w-4" />
              Total Revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold font-mono">
                {formatCurrency(summary.totalRevenue)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <Percent className="h-4 w-4" />
              Gross Margin
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold font-mono">
                {summary.grossMarginPct.toFixed(1)}%
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Section 2: Batch Cost Table */}
      <Card>
        <CardHeader>
          <CardTitle>Batch Cost Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {cogsLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !sortedCogs.length ? (
            <div className="text-center py-8 text-muted-foreground">
              No batch cost data found for the selected date range
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Batch #</TableHead>
                    <TableHead>Recipe</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead className="text-right">Vol (BBL)</TableHead>
                    <TableHead className="text-right">Malt</TableHead>
                    <TableHead className="text-right">Hops</TableHead>
                    <TableHead className="text-right">Yeast</TableHead>
                    <TableHead className="text-right">Adjunct</TableHead>
                    <TableHead className="text-right">Other</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Landed</TableHead>
                    <TableHead className="text-right">$/BBL</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedCogs.map((row) => (
                    <TableRow key={row.batch_id}>
                      <TableCell className="font-mono">
                        {row.batch_number}
                        {!row.has_allocation_data && (
                          <Badge
                            variant="outline"
                            className="ml-2 text-xs"
                            title="Estimated from recipe COGS (no allocation data)"
                          >
                            Est.
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.recipe_name ?? "--"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.brand_name ?? "--"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatBbl(row.volume_bbl)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(row.malt_cost)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(row.hops_cost)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(row.yeast_cost)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(row.adjunct_cost)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(row.other_cost)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {formatCurrency(row.total_ingredient_cost)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(row.landed_cost)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(row.cost_per_bbl)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 3: Channel Margin Table */}
      <Card>
        <CardHeader>
          <CardTitle>Margin by Channel</CardTitle>
        </CardHeader>
        <CardContent>
          {marginLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !filteredMargin.length ? (
            <div className="text-center py-8 text-muted-foreground">
              No channel margin data found for the selected date range
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">COGS</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMargin.map((row) => (
                  <TableRow key={row.channel_name}>
                    <TableCell className="font-medium">
                      {row.channel_name}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {row.order_count}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {row.unit_count}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(row.total_revenue)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(row.total_cogs)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(row.margin)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      <span
                        className={
                          row.margin_pct > 40
                            ? "text-green-600 dark:text-green-400"
                            : row.margin_pct >= 20
                              ? "text-yellow-600 dark:text-yellow-400"
                              : "text-red-600 dark:text-red-400"
                        }
                      >
                        {row.margin_pct.toFixed(1)}%
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
