"use client";

/**
 * Cost of Goods Sold (COGS) Report
 *
 * Provides three views of production cost data:
 * - By Batch: per-batch ingredient costs with COGS per unit and per BBL
 * - By SKU: costs grouped by brand + selling format with proportional allocation
 * - By Period: monthly or quarterly cost trends with category breakdown chart
 *
 * Data is derived from allocations (ingredient costs), finished_goods (units packaged),
 * and inventory_lots/inventory_items (category classification).
 *
 * A single shared query fetches batches-in-date-range, allocations, and finished goods.
 * Each tab derives its specific view from this shared data via useMemo.
 *
 * The pure aggregation math (proportional SKU cost allocation, period
 * bucketing, cost/unit helpers) lives in src/domain/reports/cogs.ts so it can be
 * unit-tested; this page only owns the queries and rendering.
 *
 * The header ExportMenu downloads a CSV of whichever tab's table is active.
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { reportKeys } from "@/lib/query-keys";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import {
  aggregateCostByKey,
  aggregateUnitsByBatch,
  buildSkuCostRows,
  buildPeriodRows,
  type CogsSkuRow,
  type CogsAllocationRow,
  type CogsFinishedGoodRow,
  type SkuFinishedGoodRow,
} from "@/domain/reports/cogs";
import { formatCurrency, formatBbl } from "@/lib/format";
import { fetchBatchIngredientDetail } from "@/domain/report-utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TableCell, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DollarSign,
  TrendingUp,
  Package,
  Hash,
  BarChart3,
} from "lucide-react";
import {
  ExpandChevron,
  ExpandedDetailRow,
  ReportDateRangeFilter,
  ReportField,
  ReportPage,
  ReportSummaryCards,
  ReportTable,
  ReportTableCard,
  StatValue,
} from "@/components/reports/report-page";
import { IngredientDetailTable } from "@/components/reports/ingredient-detail-table";
import {
  computeCogsBatchSummary,
  computeCogsPeriodSummary,
  computeCogsSkuSummary,
} from "@/domain/reports/summaries";
import { CogsPeriodChartLazy } from "@/components/domain/reports/cogs-period-chart-lazy";

// =============================================================================
// Types
// =============================================================================

/** A batch with its aggregated cost and packaging units */
type CogsBatchRow = {
  id: string;
  batch_code: string;
  name: string;
  recipe_name: string | null;
  volume_bbl: number | null;
  total_ingredient_cost: number;
  cost_per_bbl: number | null;
  units_packaged: number;
  cogs_per_unit: number | null;
  status: string;
}

/** Allocation row shape returned by the shared query */
type AllocationRow = CogsAllocationRow & { id: string }

/** Finished goods row shape returned by the shared query */
type FinishedGoodRow = CogsFinishedGoodRow

/** Batch row shape returned by the shared query */
type SharedBatchRow = {
  id: string;
  batch_code: string;
  name: string;
  status: string;
  volume_bbl: number | null;
  created_at: string;
  recipe: { name: string } | null;
}

// =============================================================================
// Helper functions
// =============================================================================

/** Default date range: last 6 months. Computed once at module level. */
const DEFAULT_FROM = format(
  startOfMonth(subMonths(new Date(), 6)),
  "yyyy-MM-dd"
);
const DEFAULT_TO = format(endOfMonth(new Date()), "yyyy-MM-dd");

// =============================================================================
// Component
// =============================================================================

export default function CogsReportPage() {
  const supabase = createClient();

  const [fromDate, setFromDate] = useState(DEFAULT_FROM);
  const [toDate, setToDate] = useState(DEFAULT_TO);
  const [activeTab, setActiveTab] = useState<
    "by-batch" | "by-sku" | "by-period"
  >("by-batch");
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [expandedSku, setExpandedSku] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<"monthly" | "quarterly">(
    "monthly"
  );

  // ---------------------------------------------------------------------------
  // Shared data query: batches + allocations + finished goods for date range
  // ---------------------------------------------------------------------------

  const {
    data: sharedData,
    isLoading: sharedLoading,
    error: sharedError,
  } = useQuery({
    queryKey: reportKeys.cogsShared({ from: fromDate, to: toDate }),
    queryFn: async () => {
      // Step 1: Get batches in date range (exclude cancelled/archived)
      const { data: batches, error: batchErr } = await supabase
        .from("batches")
        .select(
          "id, batch_code, name, status, volume_bbl, created_at, recipe:recipes(name)"
        )
        .gte("created_at", fromDate)
        .lte("created_at", toDate + "T23:59:59Z")
        .not("status", "in", '("cancelled","archived")')
        .order("batch_code", { ascending: true });

      if (batchErr) throw batchErr;
      if (!batches || batches.length === 0) {
        return { batches: [] as SharedBatchRow[], allocations: [] as AllocationRow[], finishedGoods: [] as FinishedGoodRow[] };
      }

      const batchIds = batches.map((b) => b.id);

      // Step 2: Get allocations and finished goods in parallel
      const [{ data: allocations, error: allocErr }, { data: finishedGoods, error: fgErr }] = await Promise.all([
        supabase
          .from("allocations")
          .select(
            "id, destination_id, quantity, unit_cost, source_id, source_type"
          )
          .eq("destination_type", "batch")
          .in("destination_id", batchIds)
          .in("status", ["completed", "planned"]),
        supabase
          .from("finished_goods")
          .select("batch_id, quantity")
          .in("batch_id", batchIds),
      ]);

      if (allocErr) throw allocErr;
      if (fgErr) throw fgErr;

      return {
        batches: batches.map((b) => ({
          ...b,
          recipe: b.recipe as { name: string } | null,
        })) as SharedBatchRow[],
        allocations: (allocations ?? []) as AllocationRow[],
        finishedGoods: (finishedGoods ?? []) as FinishedGoodRow[],
      };
    },
  });

  // ---------------------------------------------------------------------------
  // Tab 1 — By Batch: derive from shared data
  // ---------------------------------------------------------------------------

  const batchCostData = useMemo<CogsBatchRow[] | undefined>(() => {
    if (!sharedData) return undefined;
    const { batches, allocations, finishedGoods } = sharedData;
    if (batches.length === 0) return [];

    const costByBatch = aggregateCostByKey(allocations, (a) => a.destination_id);
    const unitsByBatch = aggregateUnitsByBatch(finishedGoods);

    return batches.map((b) => {
      const totalCost = costByBatch.get(b.id) ?? 0;
      const volumeBbl = b.volume_bbl;
      const unitsPackaged = unitsByBatch.get(b.id) ?? 0;
      return {
        id: b.id,
        batch_code: b.batch_code,
        name: b.name,
        recipe_name: b.recipe?.name ?? null,
        volume_bbl: volumeBbl,
        total_ingredient_cost: totalCost,
        cost_per_bbl:
          volumeBbl && volumeBbl > 0 ? totalCost / volumeBbl : null,
        units_packaged: unitsPackaged,
        cogs_per_unit:
          unitsPackaged > 0 ? totalCost / unitsPackaged : null,
        status: b.status,
      };
    });
  }, [sharedData]);

  // ---------------------------------------------------------------------------
  // Fetch ingredient detail for expanded batch (shared by Tab 1)
  // ---------------------------------------------------------------------------

  const { data: ingredientDetail, isLoading: detailLoading } = useQuery({
    queryKey: reportKeys.batchCostDetail(expandedBatchId ?? ""),
    queryFn: () => fetchBatchIngredientDetail(supabase, expandedBatchId),
    enabled: !!expandedBatchId,
  });

  // ---------------------------------------------------------------------------
  // Tab 2 — By SKU: fetch FG with brand/format joins, derive costs from shared
  // ---------------------------------------------------------------------------

  const {
    data: skuData,
    isLoading: skuLoading,
    error: skuError,
  } = useQuery({
    queryKey: reportKeys.cogsBySku({ from: fromDate, to: toDate }),
    queryFn: async () => {
      // Get finished goods in date range with brand + format info
      const { data: fgRows, error: fgErr } = await supabase
        .from("finished_goods")
        .select(
          "id, batch_id, quantity, selling_format_id, brand_id, brands(name), selling_formats(name, containers(name))"
        )
        .gte("created_at", fromDate)
        .lte("created_at", toDate + "T23:59:59Z");

      if (fgErr) throw fgErr;
      if (!fgRows || fgRows.length === 0) return [];

      // Get unique batch IDs from finished goods
      const batchIds = [...new Set(fgRows.map((fg) => fg.batch_id).filter(Boolean))] as string[];
      if (batchIds.length === 0) return [];

      // Get batch number info (allocations come from shared data, but we need
      // batch numbers for display and may have FG referencing batches outside
      // the shared query's date range, so fetch fresh here). Also fetch each
      // batch's full (unwindowed) packaged-unit count for totalUnitsByBatch —
      // see buildSkuCostRows in cogs.ts for why this must be unwindowed.
      const [{ data: allocations, error: allocErr }, { data: batchInfo }, { data: allFgForBatches, error: allFgErr }] =
        await Promise.all([
          supabase
            .from("allocations")
            .select("destination_id, quantity, unit_cost")
            .eq("destination_type", "batch")
            .in("destination_id", batchIds)
            .in("status", ["completed", "planned"]),
          supabase
            .from("batches")
            .select("id, batch_code")
            .in("id", batchIds),
          supabase
            .from("finished_goods")
            .select("batch_id, quantity")
            .in("batch_id", batchIds),
        ]);

      if (allocErr) throw allocErr;
      if (allFgErr) throw allFgErr;

      const totalUnitsByBatch = aggregateUnitsByBatch(
        (allFgForBatches ?? []) as CogsFinishedGoodRow[]
      );

      // Pure proportional-allocation math lives in src/domain/reports/cogs.ts.
      // Cast the joined brand/format objects to the lib's input shape.
      const skuRows: SkuFinishedGoodRow[] = fgRows.map((fg) => ({
        batch_id: fg.batch_id,
        quantity: fg.quantity,
        brands: fg.brands as { name: string } | null,
        selling_formats: fg.selling_formats as {
          name: string;
          containers: { name: string } | null;
        } | null,
      }));

      return buildSkuCostRows(skuRows, allocations ?? [], batchInfo ?? [], totalUnitsByBatch);
    },
    enabled: activeTab === "by-sku",
  });

  // ---------------------------------------------------------------------------
  // Tab 3 — By Period: derive batch/allocation data from shared, fetch category
  //         info separately (lot -> inventory_item.category)
  // ---------------------------------------------------------------------------

  const {
    data: periodData,
    isLoading: periodLoading,
    error: periodError,
  } = useQuery({
    queryKey: reportKeys.cogsByPeriod(granularity, {
      from: fromDate,
      to: toDate,
      _shared: sharedData?.batches.length ?? 0,
    }),
    queryFn: async () => {
      if (!sharedData || sharedData.batches.length === 0) return [];

      const { batches, allocations } = sharedData;

      // Get category info: source_id -> inventory_lot -> inventory_item.category
      const lotSourceIds = allocations
        .filter((a) => a.source_type === "inventory_lot" && a.source_id)
        .map((a) => a.source_id!);

      const categoryByLotId = new Map<string, string>();
      if (lotSourceIds.length > 0) {
        const { data: lots } = await supabase
          .from("inventory_lots")
          .select("id, inventory_item:inventory_items(category)")
          .in("id", lotSourceIds);

        if (lots) {
          for (const lot of lots) {
            const item = lot.inventory_item as { category: string } | null;
            if (item?.category) {
              categoryByLotId.set(lot.id, item.category.toLowerCase());
            }
          }
        }
      }

      // Pure bucketing/category math lives in src/domain/reports/cogs.ts.
      return buildPeriodRows(allocations, batches, categoryByLotId, granularity);
    },
    enabled: activeTab === "by-period" && !!sharedData,
  });

  // ---------------------------------------------------------------------------
  // Summary calculations
  // ---------------------------------------------------------------------------

  /** Tab 1 summary: batch-level metrics */
  const batchSummary = useMemo(
    () => computeCogsBatchSummary(batchCostData),
    [batchCostData]
  );

  /** Tab 2 summary: SKU-level metrics */
  const skuSummary = useMemo(() => computeCogsSkuSummary(skuData), [skuData]);

  /** Tab 3 summary: period-level metrics including category totals for the footer row */
  const periodSummary = useMemo(
    () => computeCogsPeriodSummary(periodData),
    [periodData]
  );

  // ---------------------------------------------------------------------------
  // CSV export: mirrors whichever tab's table is currently visible
  // ---------------------------------------------------------------------------

  const exportConfig = useMemo(() => {
    const range = `${fromDate}-to-${toDate}`;
    if (activeTab === "by-sku") {
      return {
        filename: `cogs-by-sku-${range}.csv`,
        loading: skuLoading,
        rows: (skuData ?? []).map((s) => ({
          SKU: s.sku_name,
          Brand: s.brand_name,
          Format: s.container_name
            ? `${s.format_name} (${s.container_name})`
            : s.format_name,
          Batches: s.batch_count,
          "Total Units": s.total_units,
          "Total Cost": Number(s.total_cost.toFixed(2)),
          "Avg Cost/Unit":
            s.avg_cost_per_unit !== null
              ? Number(s.avg_cost_per_unit.toFixed(4))
              : null,
        })),
      };
    }
    if (activeTab === "by-period") {
      return {
        filename: `cogs-by-period-${granularity}-${range}.csv`,
        loading: periodLoading,
        rows: (periodData ?? []).map((p) => ({
          Period: p.period,
          "Total COGS": Number(p.total_cogs.toFixed(2)),
          Malts: Number(p.malt_cost.toFixed(2)),
          Hops: Number(p.hop_cost.toFixed(2)),
          Yeast: Number(p.yeast_cost.toFixed(2)),
          Adjuncts: Number(p.adjunct_cost.toFixed(2)),
          Other: Number(p.other_cost.toFixed(2)),
          Batches: p.batch_count,
        })),
      };
    }
    return {
      filename: `cogs-by-batch-${range}.csv`,
      loading: sharedLoading,
      rows: (batchCostData ?? []).map((b) => ({
        "Batch Code": b.batch_code,
        Name: b.name,
        Recipe: b.recipe_name,
        "Volume (BBL)": b.volume_bbl,
        "Ingredient Cost": Number(b.total_ingredient_cost.toFixed(2)),
        "Units Packaged": b.units_packaged,
        "COGS/Unit":
          b.cogs_per_unit !== null
            ? Number(b.cogs_per_unit.toFixed(4))
            : null,
        "COGS/BBL":
          b.cost_per_bbl !== null
            ? Number(b.cost_per_bbl.toFixed(2))
            : null,
      })),
    };
  }, [
    activeTab,
    fromDate,
    toDate,
    granularity,
    skuData,
    skuLoading,
    periodData,
    periodLoading,
    batchCostData,
    sharedLoading,
  ]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function toggleBatchExpand(batchId: string) {
    setExpandedBatchId((prev) => (prev === batchId ? null : batchId));
  }

  function toggleSkuExpand(skuName: string) {
    setExpandedSku((prev) => (prev === skuName ? null : skuName));
  }

  // ---------------------------------------------------------------------------
  // Loading / error derivation
  // ---------------------------------------------------------------------------

  const currentError = activeTab === "by-batch" ? sharedError : activeTab === "by-sku" ? skuError : periodError;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <ReportPage
      title="Cost of Goods Sold"
      description="Analyze production costs by batch, SKU, or time period"
      exportConfig={{
        filename: exportConfig.filename,
        rows: exportConfig.rows,
        disabled: exportConfig.loading,
      }}
      filter={
        <ReportDateRangeFilter
          description="Filter data by batch creation date"
          fromDate={fromDate}
          toDate={toDate}
          onFromDateChange={setFromDate}
          onToDateChange={setToDate}
        />
      }
      error={currentError}
      errorFallback="Failed to load COGS data"
      note={
        <>
          COGS are derived from allocation records linking inventory lots to
          batches and finished goods packaging records. Only allocations with
          status &quot;completed&quot; or &quot;planned&quot; are included. Cost
          per unit uses proportional allocation based on units packaged from
          each batch.
        </>
      }
    >
      <Tabs
        value={activeTab}
        onValueChange={(v) =>
          setActiveTab(v as "by-batch" | "by-sku" | "by-period")
        }
      >
        <TabsList>
          <TabsTrigger value="by-batch">By Batch</TabsTrigger>
          <TabsTrigger value="by-sku">By SKU</TabsTrigger>
          <TabsTrigger value="by-period">By Period</TabsTrigger>
        </TabsList>

        {/* ================================================================= */}
        {/* Tab 1: By Batch                                                    */}
        {/* ================================================================= */}
        <TabsContent value="by-batch" className="space-y-6">
          <ReportSummaryCards
            loading={sharedLoading}
            columns={4}
            cards={[
              {
                icon: TrendingUp,
                label: "Avg Cost / BBL",
                value: (
                  <StatValue>
                    {formatCurrency(batchSummary.avgCostPerBbl)}
                  </StatValue>
                ),
              },
              {
                icon: DollarSign,
                label: "Total Material Costs",
                value: (
                  <StatValue>
                    {formatCurrency(batchSummary.totalMaterialCost)}
                  </StatValue>
                ),
              },
              {
                icon: Hash,
                label: "Batches",
                value: <StatValue>{batchSummary.batchCount}</StatValue>,
              },
              {
                icon: Package,
                label: "Units Packaged",
                value: (
                  <StatValue>
                    {batchSummary.totalUnitsPackaged.toLocaleString()}
                  </StatValue>
                ),
              },
            ]}
          />

          <ReportTableCard
            title="COGS by Batch"
            description="Click a row to expand ingredient-level detail"
            loading={sharedLoading}
            isEmpty={!batchCostData || batchCostData.length === 0}
            emptyMessage="No batches found in the selected date range"
          >
            <ReportTable
              rows={batchCostData ?? []}
              rowKey={(b) => b.id}
              rowClassName="cursor-pointer hover:bg-muted/50"
              onRowClick={(b) => toggleBatchExpand(b.id)}
              columns={[
                {
                  header: "",
                  headClassName: "w-8",
                  cellClassName: "w-8",
                  cell: (b) => (
                    <ExpandChevron expanded={expandedBatchId === b.id} />
                  ),
                },
                {
                  header: "Batch Code",
                  cellClassName: "font-mono",
                  cell: (b) => b.batch_code,
                },
                { header: "Name", cell: (b) => b.name },
                {
                  header: "Recipe",
                  cellClassName: "text-muted-foreground",
                  cell: (b) => b.recipe_name ?? "--",
                },
                {
                  header: "Vol (BBL)",
                  headClassName: "text-right",
                  cellClassName: "text-right font-mono",
                  cell: (b) => formatBbl(b.volume_bbl),
                },
                {
                  header: "Ingredient Cost",
                  headClassName: "text-right",
                  cellClassName: "text-right font-mono font-medium",
                  cell: (b) => formatCurrency(b.total_ingredient_cost),
                },
                {
                  header: "Units Packaged",
                  headClassName: "text-right",
                  cellClassName: "text-right font-mono",
                  cell: (b) => b.units_packaged.toLocaleString(),
                },
                {
                  header: "COGS/Unit",
                  headClassName: "text-right",
                  cellClassName: "text-right font-mono",
                  cell: (b) => formatCurrency(b.cogs_per_unit),
                },
                {
                  header: "COGS/BBL",
                  headClassName: "text-right",
                  cellClassName: "text-right font-mono",
                  cell: (b) => formatCurrency(b.cost_per_bbl),
                },
              ]}
              renderAfterRow={(b) =>
                expandedBatchId === b.id && (
                  <ExpandedDetailRow colSpan={9} title="Ingredient Cost Detail">
                    <IngredientDetailTable
                      loading={detailLoading}
                      rows={ingredientDetail}
                    />
                  </ExpandedDetailRow>
                )
              }
            />
          </ReportTableCard>
        </TabsContent>

        {/* ================================================================= */}
        {/* Tab 2: By SKU                                                      */}
        {/* ================================================================= */}
        <TabsContent value="by-sku" className="space-y-6">
          <ReportSummaryCards
            loading={skuLoading}
            cards={[
              {
                icon: TrendingUp,
                label: "Highest Cost SKU",
                value: <SkuStat sku={skuSummary.highestCostSku} />,
                skeletonClassName: "w-32",
              },
              {
                icon: Package,
                label: "Lowest Cost SKU",
                value: <SkuStat sku={skuSummary.lowestCostSku} />,
                skeletonClassName: "w-32",
              },
              {
                icon: DollarSign,
                label: "Weighted Avg Cost/Unit",
                value: (
                  <StatValue>
                    {formatCurrency(skuSummary.weightedAvgCostPerUnit)}
                  </StatValue>
                ),
              },
            ]}
          />

          <ReportTableCard
            title="COGS by SKU"
            description="Click a row to see batch breakdown"
            loading={skuLoading}
            isEmpty={!skuData || skuData.length === 0}
            emptyMessage="No finished goods found in the selected date range"
          >
            <ReportTable
              rows={skuData ?? []}
              rowKey={(s) => s.sku_name}
              rowClassName="cursor-pointer hover:bg-muted/50"
              onRowClick={(s) => toggleSkuExpand(s.sku_name)}
              columns={[
                {
                  header: "",
                  headClassName: "w-8",
                  cellClassName: "w-8",
                  cell: (s) => (
                    <ExpandChevron expanded={expandedSku === s.sku_name} />
                  ),
                },
                {
                  header: "SKU",
                  cellClassName: "font-medium",
                  cell: (s) => s.sku_name,
                },
                { header: "Brand", cell: (s) => s.brand_name },
                {
                  header: "Format",
                  cellClassName: "text-muted-foreground",
                  cell: (s) =>
                    s.container_name
                      ? `${s.format_name} (${s.container_name})`
                      : s.format_name,
                },
                {
                  header: "Batches",
                  headClassName: "text-right",
                  cellClassName: "text-right font-mono",
                  cell: (s) => s.batch_count,
                },
                {
                  header: "Total Units",
                  headClassName: "text-right",
                  cellClassName: "text-right font-mono",
                  cell: (s) => s.total_units.toLocaleString(),
                },
                {
                  header: "Total Cost",
                  headClassName: "text-right",
                  cellClassName: "text-right font-mono font-medium",
                  cell: (s) => formatCurrency(s.total_cost),
                },
                {
                  header: "Avg Cost/Unit",
                  headClassName: "text-right",
                  cellClassName: "text-right font-mono",
                  cell: (s) => formatCurrency(s.avg_cost_per_unit),
                },
              ]}
              renderAfterRow={(sku) =>
                expandedSku === sku.sku_name && (
                  <ExpandedDetailRow colSpan={8} title="Batch Breakdown">
                    <ReportTable
                      rows={sku.batches}
                      rowKey={(b) => b.id}
                      columns={[
                        {
                          header: "Batch Code",
                          cellClassName: "font-mono",
                          cell: (b) => b.batch_code,
                        },
                        {
                          header: "Units",
                          headClassName: "text-right",
                          cellClassName: "text-right font-mono",
                          cell: (b) => b.units.toLocaleString(),
                        },
                        {
                          header: "Cost",
                          headClassName: "text-right",
                          cellClassName: "text-right font-mono",
                          cell: (b) => formatCurrency(b.cost),
                        },
                        {
                          header: "Cost/Unit",
                          headClassName: "text-right",
                          cellClassName: "text-right font-mono",
                          cell: (b) =>
                            formatCurrency(b.units > 0 ? b.cost / b.units : null),
                        },
                      ]}
                    />
                  </ExpandedDetailRow>
                )
              }
            />
          </ReportTableCard>
        </TabsContent>

        {/* ================================================================= */}
        {/* Tab 3: By Period                                                   */}
        {/* ================================================================= */}
        <TabsContent value="by-period" className="space-y-6">
          {/* Granularity selector */}
          <div className="flex items-end gap-4">
            <ReportField label="Granularity">
              <Select
                value={granularity}
                onValueChange={(v) =>
                  setGranularity(v as "monthly" | "quarterly")
                }
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                </SelectContent>
              </Select>
            </ReportField>
          </div>

          <ReportSummaryCards
            loading={periodLoading}
            cards={[
              {
                icon: DollarSign,
                label: "Total COGS",
                value: (
                  <StatValue>
                    {formatCurrency(periodSummary.totalCogs)}
                  </StatValue>
                ),
              },
              {
                icon: TrendingUp,
                label: "Period-over-Period",
                value:
                  periodSummary.periodChange !== null ? (
                    <div
                      className={`text-2xl font-bold font-mono ${periodSummary.periodChange > 0 ? "text-red-600" : "text-green-600"}`}
                    >
                      {periodSummary.periodChange > 0 ? "+" : ""}
                      {periodSummary.periodChange.toFixed(1)}%
                    </div>
                  ) : (
                    <StatValue>--</StatValue>
                  ),
              },
              {
                icon: BarChart3,
                label: "Avg COGS / Batch",
                value: (
                  <StatValue>
                    {formatCurrency(periodSummary.avgCogsPerBatch)}
                  </StatValue>
                ),
              },
            ]}
          />

          {/* Stacked Bar Chart */}
          <Card>
            <CardHeader>
              <CardTitle>COGS by Period</CardTitle>
              <CardDescription>
                Ingredient cost breakdown over time
              </CardDescription>
            </CardHeader>
            <CardContent>
              {periodLoading ? (
                <Skeleton className="h-[400px] w-full" />
              ) : !periodData || periodData.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No data for the selected date range
                </div>
              ) : (
                <CogsPeriodChartLazy data={periodData} />
              )}
            </CardContent>
          </Card>

          <ReportTableCard
            title="Period Detail"
            loading={periodLoading}
            skeletonRows={4}
            isEmpty={!periodData || periodData.length === 0}
            emptyMessage="No data for the selected date range"
          >
            <ReportTable
              rows={periodData ?? []}
              rowKey={(p) => p.period}
              columns={[
                {
                  header: "Period",
                  cellClassName: "font-medium",
                  cell: (p) => p.period,
                },
                {
                  header: "Total COGS",
                  headClassName: "text-right",
                  cellClassName: "text-right font-mono font-medium",
                  cell: (p) => formatCurrency(p.total_cogs),
                },
                {
                  header: "Malts",
                  headClassName: "text-right",
                  cellClassName: "text-right font-mono",
                  cell: (p) => formatCurrency(p.malt_cost),
                },
                {
                  header: "Hops",
                  headClassName: "text-right",
                  cellClassName: "text-right font-mono",
                  cell: (p) => formatCurrency(p.hop_cost),
                },
                {
                  header: "Yeast",
                  headClassName: "text-right",
                  cellClassName: "text-right font-mono",
                  cell: (p) => formatCurrency(p.yeast_cost),
                },
                {
                  header: "Adjuncts",
                  headClassName: "text-right",
                  cellClassName: "text-right font-mono",
                  cell: (p) => formatCurrency(p.adjunct_cost),
                },
                {
                  header: "Other",
                  headClassName: "text-right",
                  cellClassName: "text-right font-mono",
                  cell: (p) => formatCurrency(p.other_cost),
                },
                {
                  header: "Batches",
                  headClassName: "text-right",
                  cellClassName: "text-right font-mono",
                  cell: (p) => p.batch_count,
                },
              ]}
              footer={
                (periodData?.length ?? 0) > 1 && (
                  <TableRow className="font-bold border-t-2">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(periodSummary.totalCogs)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(periodSummary.totalMalt)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(periodSummary.totalHop)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(periodSummary.totalYeast)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(periodSummary.totalAdjunct)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(periodSummary.totalOther)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {periodSummary.totalBatches}
                    </TableCell>
                  </TableRow>
                )
              }
            />
          </ReportTableCard>
        </TabsContent>
      </Tabs>
    </ReportPage>
  );
}

/**
 * Highest/lowest-cost SKU stat: cost per unit over the SKU name, or "--" when
 * no SKU qualifies.
 */
function SkuStat({ sku }: { sku: CogsSkuRow | null }) {
  if (!sku) return <StatValue>--</StatValue>;
  return (
    <div>
      <div className="text-lg font-bold font-mono">
        {formatCurrency(sku.avg_cost_per_unit)}
        <span className="text-xs font-normal text-muted-foreground"> /unit</span>
      </div>
      <p className="text-sm text-muted-foreground truncate">{sku.sku_name}</p>
    </div>
  );
}
