"use client";

/**
 * Production Summary Report Page
 *
 * Displays aggregate production metrics for a selected date range:
 * - Summary cards: total batches, total BBL produced, average days in tank
 * - Production by brand table (exportable to CSV via the header ExportMenu)
 * - Production by style breakdown
 *
 * Data is fetched from the batches table (joined with recipes and brands)
 * filtered to completed/packaged batches within the reporting period.
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MONTHS } from "@/domain/ttb-utils";
import { createClient } from "@/lib/supabase/client";
import { reportKeys } from "@/lib/query-keys";
import { formatBbl } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "lucide-react";
import {
  ReportField,
  ReportFilterCard,
  ReportPage,
  ReportSummaryCards,
  ReportTable,
  ReportTableCard,
  StatValue,
} from "@/components/reports/report-page";
import {
  aggregateProduction,
  computeAvgDaysInTank,
  type ProductionAggregate,
} from "@/lib/reports/summaries";
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  format,
  parseISO,
  differenceInDays,
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
// Helper Functions
// =============================================================================

/** Generate year options: current year and 3 years back. */
function getYearOptions(): number[] {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: 4 }, (_, i) => currentYear - i);
}

/**
 * Days a batch has been in tank: planned_start_date to now.
 * Passed to {@link computeAvgDaysInTank}, which handles the null/negative cases.
 */
function daysSincePlannedStart(plannedStart: string): number {
  return differenceInDays(new Date(), parseISO(plannedStart));
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

  const avgDaysInTank = useMemo(
    () => computeAvgDaysInTank(batches, daysSincePlannedStart),
    [batches]
  );

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
  // CSV export rows (mirrors the Production by Brand table, the page's
  // primary breakdown)
  // ---------------------------------------------------------------------------
  const exportRows = useMemo(
    () =>
      brandProduction.map((row) => ({
        Brand: row.label,
        "# Batches": row.batchCount,
        "Total BBL": Number(row.totalBbl.toFixed(2)),
        "Avg BBL / Batch": Number(row.avgBblPerBatch.toFixed(2)),
      })),
    [brandProduction]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <ReportPage
      title="Production Summary"
      description="Monthly production volumes by brand and style"
      exportConfig={{
        filename: `production-summary-${year}-${String(month).padStart(2, "0")}.csv`,
        rows: exportRows,
        disabled: isLoading,
      }}
      filter={
        <ReportFilterCard
          title={
            <span className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Reporting Period
            </span>
          }
        >
          <ReportField label="Year">
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
          </ReportField>
          <ReportField label="Month">
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
          </ReportField>
          <div className="pb-2 text-muted-foreground font-medium">
            {monthName} {year}
          </div>
        </ReportFilterCard>
      }
      error={error}
      errorFallback="Failed to load production summary data"
    >
      <ReportSummaryCards
        loading={isLoading}
        cards={[
          {
            label: "Total Batches",
            value: <StatValue>{totalBatches}</StatValue>,
            skeletonClassName: "w-20",
          },
          {
            label: "Total Produced",
            value: (
              <StatValue>
                {formatBbl(totalBbl)}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  BBL
                </span>
              </StatValue>
            ),
            skeletonClassName: "w-20",
          },
          {
            label: "Avg Days in Tank",
            value: (
              <StatValue>
                {avgDaysInTank !== null ? avgDaysInTank.toFixed(1) : "--"}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  days
                </span>
              </StatValue>
            ),
            skeletonClassName: "w-20",
          },
        ]}
      />

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
              series={[{ key: "volume_bbl", label: "Volume (BBL)" }]}
              type="bar"
              height={280}
              formatValue={(v) => `${v.toFixed(1)} BBL`}
            />
          ) : (
            <Skeleton className="h-[280px] w-full" />
          )}
        </CardContent>
      </Card>

      <ProductionBreakdownCard
        title="Production by Brand"
        description={`Aggregate volumes per brand for ${monthName} ${year}`}
        groupHeader="Brand"
        rows={brandProduction}
        loading={isLoading}
        totalBatches={totalBatches}
        totalBbl={totalBbl}
      />

      <ProductionBreakdownCard
        title="Production by Style"
        description={`Aggregate volumes per beer style for ${monthName} ${year}`}
        groupHeader="Style"
        rows={styleProduction}
        loading={isLoading}
        totalBatches={totalBatches}
        totalBbl={totalBbl}
      />
    </ReportPage>
  );
}

/**
 * One production breakdown table (by brand or by style): the group column plus
 * batch count / total BBL / average BBL, with a totals row when there is more
 * than one group.
 */
function ProductionBreakdownCard({
  title,
  description,
  groupHeader,
  rows,
  loading,
  totalBatches,
  totalBbl,
}: {
  title: string;
  description: string;
  groupHeader: string;
  rows: ProductionAggregate[];
  loading: boolean;
  totalBatches: number;
  totalBbl: number;
}) {
  return (
    <ReportTableCard
      title={title}
      description={description}
      loading={loading}
      skeletonRows={4}
      isEmpty={rows.length === 0}
      emptyMessage="No completed batches in this period"
    >
      <ReportTable
        rows={rows}
        rowKey={(r) => r.key}
        columns={[
          {
            header: groupHeader,
            cellClassName: "font-medium",
            cell: (r) => r.label,
          },
          {
            header: "# Batches",
            headClassName: "text-right",
            cellClassName: "text-right font-mono",
            cell: (r) => r.batchCount,
          },
          {
            header: "Total BBL",
            headClassName: "text-right",
            cellClassName: "text-right font-mono",
            cell: (r) => formatBbl(r.totalBbl),
          },
          {
            header: "Avg BBL / Batch",
            headClassName: "text-right",
            cellClassName: "text-right font-mono",
            cell: (r) => formatBbl(r.avgBblPerBatch),
          },
        ]}
        footer={
          rows.length > 1 && (
            <TableRow className="font-bold border-t-2">
              <TableCell>Total</TableCell>
              <TableCell className="text-right font-mono">
                {totalBatches}
              </TableCell>
              <TableCell className="text-right font-mono">
                {formatBbl(totalBbl)}
              </TableCell>
              <TableCell className="text-right font-mono">
                {totalBatches > 0 ? formatBbl(totalBbl / totalBatches) : "0.00"}
              </TableCell>
            </TableRow>
          )
        }
      />
    </ReportTableCard>
  );
}
