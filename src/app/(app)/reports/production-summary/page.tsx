"use client";

/**
 * Production Summary Report Page
 *
 * Displays aggregate production metrics for a selected date range:
 * - Summary cards: total batches, total BBL produced, average days in tank
 * - Production by brand table
 * - Production by style breakdown
 *
 * Data is fetched from the batches table (joined with recipes and brands)
 * filtered to completed/packaged batches within the reporting period.
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { reportKeys } from "@/lib/query-keys";
import { formatBbl } from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Calendar,
  AlertCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Link from "next/link";
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  format,
  differenceInDays,
  parseISO,
} from "date-fns";
import { TrendChart } from "@/components/dashboard/trend-chart";

// =============================================================================
// Types
// =============================================================================

/** Shape returned by the Supabase query for completed/packaged batches. */
type ProductionBatchRow = {
  id: string;
  batch_code: string;
  name: string;
  status: string;
  volume_bbl: number | null;
  planned_start_date: string | null;
  recipe_id: string | null;
  recipes: {
    id: string;
    name: string;
    style: string | null;
    brand_id: string | null;
    brands: {
      id: string;
      name: string;
    } | null;
  } | null;
}

// =============================================================================
// Constants
// =============================================================================

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// =============================================================================
// Helper Functions
// =============================================================================

/** Generate year options: current year and 3 years back. */
function getYearOptions(): number[] {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: 4 }, (_, i) => currentYear - i);
}

/**
 * Calculate the number of days a batch has been in tank.
 * Uses planned_start_date as start and the current date as end.
 * Returns null if the start date is missing.
 */
function daysInTank(
  plannedStart: string | null,
): number | null {
  if (!plannedStart) return null;
  return differenceInDays(new Date(), parseISO(plannedStart));
}

/** Shared aggregation shape used by both brand and style summaries. */
type ProductionAggregate = {
  key: string;
  label: string;
  batchCount: number;
  totalBbl: number;
  avgBblPerBatch: number;
}

/**
 * Aggregate batches into production summaries by a key extractor.
 * Returns rows sorted descending by totalBbl.
 */
function aggregateProduction(
  batches: ProductionBatchRow[],
  getKey: (b: ProductionBatchRow) => string,
  getLabel: (b: ProductionBatchRow) => string,
): ProductionAggregate[] {
  const map = new Map<string, { label: string; batchCount: number; totalBbl: number }>();

  for (const b of batches) {
    const key = getKey(b);
    const existing = map.get(key) ?? { label: getLabel(b), batchCount: 0, totalBbl: 0 };
    existing.batchCount += 1;
    existing.totalBbl += b.volume_bbl ?? 0;
    map.set(key, existing);
  }

  return Array.from(map.entries())
    .map(([key, v]) => ({
      key,
      label: v.label,
      batchCount: v.batchCount,
      totalBbl: v.totalBbl,
      avgBblPerBatch: v.batchCount > 0 ? v.totalBbl / v.batchCount : 0,
    }))
    .sort((a, b) => b.totalBbl - a.totalBbl);
}

// =============================================================================
// Component
// =============================================================================

export default function ProductionSummaryPage() {
  const supabase = createClient();
  const currentDate = new Date();
  const [year, setYear] = useState(currentDate.getFullYear());
  const [month, setMonth] = useState(currentDate.getMonth() + 1);

  // Compute date range from selected year/month
  const startDate = format(
    startOfMonth(new Date(year, month - 1)),
    "yyyy-MM-dd"
  );
  const endDate = format(endOfMonth(new Date(year, month - 1)), "yyyy-MM-dd");

  // ---------------------------------------------------------------------------
  // Data Fetching
  // ---------------------------------------------------------------------------

  const {
    data: batches,
    isLoading,
    error,
  } = useQuery({
    queryKey: reportKeys.productionSummary(startDate, endDate),
    queryFn: async () => {
      // Filter by planned_start_date (production date), not updated_at which
      // changes on any record modification and is not a reliable production date.
      const { data, error: queryError } = await supabase
        .from("batches")
        .select(
          `
          id,
          batch_code,
          name,
          status,
          volume_bbl,
          planned_start_date,
          recipe_id,
          recipes (
            id,
            name,
            style,
            brand_id,
            brands (
              id,
              name
            )
          )
        `
        )
        .in("status", ["completed", "packaging"])
        .gte("planned_start_date", startDate)
        .lte("planned_start_date", endDate + "T23:59:59Z")
        .order("planned_start_date", { ascending: false });

      if (queryError) throw queryError;
      return (data ?? []) as unknown as ProductionBatchRow[];
    },
  });

  // ---------------------------------------------------------------------------
  // 12-Month Trend Data
  // ---------------------------------------------------------------------------

  const TREND_MONTHS = 12;

  const { data: trendData } = useQuery({
    queryKey: reportKeys.productionTrend(TREND_MONTHS),
    queryFn: async () => {
      const now = new Date();
      const trendStart = format(
        startOfMonth(subMonths(now, TREND_MONTHS - 1)),
        "yyyy-MM-dd"
      );
      const trendEnd = format(endOfMonth(now), "yyyy-MM-dd");

      const { data, error: queryError } = await supabase
        .from("batches")
        .select("id, volume_bbl, planned_start_date")
        .in("status", ["completed", "packaging"])
        .gte("planned_start_date", trendStart)
        .lte("planned_start_date", trendEnd + "T23:59:59Z");

      if (queryError) throw queryError;

      // Aggregate by month using planned_start_date (production date)
      const monthMap = new Map<string, { bbl: number; batches: number }>();

      // Pre-populate all months so the chart has no gaps
      for (let i = TREND_MONTHS - 1; i >= 0; i--) {
        const d = subMonths(now, i);
        const key = format(startOfMonth(d), "yyyy-MM-dd");
        monthMap.set(key, { bbl: 0, batches: 0 });
      }

      for (const row of data ?? []) {
        if (!row.planned_start_date) continue;
        const key = format(startOfMonth(parseISO(row.planned_start_date)), "yyyy-MM-dd");
        const entry = monthMap.get(key);
        if (entry) {
          entry.bbl += row.volume_bbl ?? 0;
          entry.batches += 1;
        }
      }

      return Array.from(monthMap.entries()).map(([date, v]) => ({
        date,
        volume_bbl: parseFloat(v.bbl.toFixed(2)),
        batches: v.batches,
      }));
    },
  });

  // ---------------------------------------------------------------------------
  // Derived Data
  // ---------------------------------------------------------------------------

  const totalBatches = batches?.length ?? 0;

  const totalBbl = useMemo(
    () =>
      (batches ?? []).reduce((sum, b) => sum + (b.volume_bbl ?? 0), 0),
    [batches]
  );

  const avgDaysInTank = useMemo(() => {
    if (!batches || batches.length === 0) return null;
    const days = batches
      .map((b) => daysInTank(b.planned_start_date))
      .filter((d): d is number => d !== null && d >= 0);
    if (days.length === 0) return null;
    return days.reduce((sum, d) => sum + d, 0) / days.length;
  }, [batches]);

  /** Production aggregated by brand. */
  const brandProduction = useMemo(
    () =>
      batches
        ? aggregateProduction(
            batches,
            (b) => b.recipes?.brand_id ?? "_unassigned",
            (b) => b.recipes?.brands?.name ?? "Unassigned",
          )
        : [],
    [batches],
  );

  /** Production aggregated by beer style. */
  const styleProduction = useMemo(
    () =>
      batches
        ? aggregateProduction(
            batches,
            (b) => b.recipes?.style ?? "Unknown",
            (b) => b.recipes?.style ?? "Unknown",
          )
        : [],
    [batches],
  );

  const monthName = MONTHS[month - 1];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/reports">
          <Button variant="ghost" size="icon" aria-label="Back to reports">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">
            Production Summary
          </h1>
          <p className="text-muted-foreground">
            Monthly production volumes by brand and style
          </p>
        </div>
      </div>

      {/* Period Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Calendar className="h-5 w-5" />
            Reporting Period
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4">
            <div className="space-y-2">
              <Label>Year</Label>
              <Select
                value={year.toString()}
                onValueChange={(v) => setYear(parseInt(v))}
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getYearOptions().map((y) => (
                    <SelectItem key={y} value={y.toString()}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Month</Label>
              <Select
                value={month.toString()}
                onValueChange={(v) => setMonth(parseInt(v))}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={i} value={(i + 1).toString()}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="pb-2 text-muted-foreground font-medium">
              {monthName} {year}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error Loading Report</AlertTitle>
          <AlertDescription>
            {error instanceof Error
              ? error.message
              : "Failed to load production summary data"}
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Batches
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold font-mono">
                {totalBatches}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Produced
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold font-mono">
                {formatBbl(totalBbl)}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  BBL
                </span>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Days in Tank
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold font-mono">
                {avgDaysInTank !== null ? avgDaysInTank.toFixed(1) : "--"}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  days
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Monthly Production Trend (12 months) */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly Production Volume</CardTitle>
          <CardDescription>
            Completed/packaged batch volume over the last 12 months
          </CardDescription>
        </CardHeader>
        <CardContent>
          {trendData && trendData.length > 0 ? (
            <TrendChart
              data={trendData}
              xKey="date"
              series={[
                { key: "volume_bbl", label: "Volume (BBL)" },
              ]}
              type="bar"
              height={280}
              formatValue={(v) => `${v.toFixed(1)} BBL`}
            />
          ) : (
            <Skeleton className="h-[280px] w-full" />
          )}
        </CardContent>
      </Card>

      {/* Production by Brand */}
      <Card>
        <CardHeader>
          <CardTitle>Production by Brand</CardTitle>
          <CardDescription>
            Aggregate volumes per brand for {monthName} {year}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : brandProduction.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              No completed batches in this period
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Brand</TableHead>
                  <TableHead className="text-right"># Batches</TableHead>
                  <TableHead className="text-right">Total BBL</TableHead>
                  <TableHead className="text-right">
                    Avg BBL / Batch
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {brandProduction.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-medium">
                      {row.label}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {row.batchCount}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatBbl(row.totalBbl)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatBbl(row.avgBblPerBatch)}
                    </TableCell>
                  </TableRow>
                ))}
                {brandProduction.length > 1 && (
                  <TableRow className="font-bold border-t-2">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right font-mono">
                      {totalBatches}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatBbl(totalBbl)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {totalBatches > 0
                        ? formatBbl(totalBbl / totalBatches)
                        : "0.00"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Production by Style */}
      <Card>
        <CardHeader>
          <CardTitle>Production by Style</CardTitle>
          <CardDescription>
            Aggregate volumes per beer style for {monthName} {year}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : styleProduction.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              No completed batches in this period
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Style</TableHead>
                  <TableHead className="text-right"># Batches</TableHead>
                  <TableHead className="text-right">Total BBL</TableHead>
                  <TableHead className="text-right">
                    Avg BBL / Batch
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {styleProduction.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-medium">
                      {row.label}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {row.batchCount}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatBbl(row.totalBbl)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatBbl(row.avgBblPerBatch)}
                    </TableCell>
                  </TableRow>
                ))}
                {styleProduction.length > 1 && (
                  <TableRow className="font-bold border-t-2">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right font-mono">
                      {totalBatches}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatBbl(totalBbl)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {totalBatches > 0
                        ? formatBbl(totalBbl / totalBatches)
                        : "0.00"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
