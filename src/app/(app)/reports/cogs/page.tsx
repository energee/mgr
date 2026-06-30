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
 * bucketing, cost/unit helpers) lives in src/lib/reports/cogs.ts so it can be
 * unit-tested; this page only owns the queries and rendering.
 */

import React, { useState, useMemo } from "react";
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
} from "@/lib/reports/cogs";
import { formatCurrency, formatBbl } from "@/lib/format";
import { fetchBatchIngredientDetail } from "@/domain/report-utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import {
  ArrowLeft,
  AlertCircle,
  DollarSign,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  Package,
  Hash,
  BarChart3,
} from "lucide-react";
import Link from "next/link";
// Chart is lazy-loaded so recharts stays out of the initial bundle — it only
// renders in the By Period tab.
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
      // the shared query's date range, so fetch fresh here)
      const [{ data: allocations, error: allocErr }, { data: batchInfo }] = await Promise.all([
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
      ]);

      if (allocErr) throw allocErr;

      // Pure proportional-allocation math lives in src/lib/reports/cogs.ts.
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

      return buildSkuCostRows(skuRows, allocations ?? [], batchInfo ?? []);
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

      // Pure bucketing/category math lives in src/lib/reports/cogs.ts.
      return buildPeriodRows(allocations, batches, categoryByLotId, granularity);
    },
    enabled: activeTab === "by-period" && !!sharedData,
  });

  // ---------------------------------------------------------------------------
  // Summary calculations
  // ---------------------------------------------------------------------------

  /** Tab 1 summary: batch-level metrics */
  const batchSummary = useMemo(() => {
    if (!batchCostData || batchCostData.length === 0) {
      return {
        avgCostPerBbl: 0,
        totalMaterialCost: 0,
        batchCount: 0,
        totalUnitsPackaged: 0,
      };
    }

    const totalMaterialCost = batchCostData.reduce(
      (sum, b) => sum + b.total_ingredient_cost,
      0
    );
    const batchesWithVolume = batchCostData.filter(
      (b) => b.volume_bbl && b.volume_bbl > 0
    );
    const totalVolume = batchesWithVolume.reduce(
      (sum, b) => sum + (b.volume_bbl ?? 0),
      0
    );
    const totalUnitsPackaged = batchCostData.reduce(
      (sum, b) => sum + b.units_packaged,
      0
    );

    return {
      avgCostPerBbl: totalVolume > 0 ? totalMaterialCost / totalVolume : 0,
      totalMaterialCost,
      batchCount: batchCostData.length,
      totalUnitsPackaged,
    };
  }, [batchCostData]);

  /** Tab 2 summary: SKU-level metrics */
  const skuSummary = useMemo(() => {
    if (!skuData || skuData.length === 0) {
      return {
        highestCostSku: null as CogsSkuRow | null,
        lowestCostSku: null as CogsSkuRow | null,
        weightedAvgCostPerUnit: 0,
      };
    }

    const withUnits = skuData.filter((s) => s.total_units > 0);
    const sorted = [...withUnits].sort(
      (a, b) => (b.avg_cost_per_unit ?? 0) - (a.avg_cost_per_unit ?? 0)
    );

    const totalCost = withUnits.reduce((sum, s) => sum + s.total_cost, 0);
    const totalUnits = withUnits.reduce((sum, s) => sum + s.total_units, 0);

    return {
      highestCostSku: sorted[0] ?? null,
      lowestCostSku: sorted[sorted.length - 1] ?? null,
      weightedAvgCostPerUnit: totalUnits > 0 ? totalCost / totalUnits : 0,
    };
  }, [skuData]);

  /** Tab 3 summary: period-level metrics including category totals for the footer row */
  const periodSummary = useMemo(() => {
    if (!periodData || periodData.length === 0) {
      return {
        totalCogs: 0,
        periodChange: null as number | null,
        avgCogsPerBatch: 0,
        totalMalt: 0,
        totalHop: 0,
        totalYeast: 0,
        totalAdjunct: 0,
        totalOther: 0,
        totalBatches: 0,
      };
    }

    // Single-pass aggregation across all period rows
    let totalCogs = 0;
    let totalBatches = 0;
    let totalMalt = 0;
    let totalHop = 0;
    let totalYeast = 0;
    let totalAdjunct = 0;
    let totalOther = 0;
    for (const p of periodData) {
      totalCogs += p.total_cogs;
      totalBatches += p.batch_count;
      totalMalt += p.malt_cost;
      totalHop += p.hop_cost;
      totalYeast += p.yeast_cost;
      totalAdjunct += p.adjunct_cost;
      totalOther += p.other_cost;
    }

    // Period-over-period change (compare last 2 periods)
    let periodChange: number | null = null;
    if (periodData.length >= 2) {
      const last = periodData[periodData.length - 1].total_cogs;
      const prev = periodData[periodData.length - 2].total_cogs;
      if (prev > 0) {
        periodChange = ((last - prev) / prev) * 100;
      }
    }

    return {
      totalCogs,
      periodChange,
      avgCogsPerBatch: totalBatches > 0 ? totalCogs / totalBatches : 0,
      totalMalt,
      totalHop,
      totalYeast,
      totalAdjunct,
      totalOther,
      totalBatches,
    };
  }, [periodData]);

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
            Cost of Goods Sold
          </h1>
          <p className="text-muted-foreground">
            Analyze production costs by batch, SKU, or time period
          </p>
        </div>
      </div>

      {/* Date Range */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Date Range</CardTitle>
          <CardDescription>
            Filter data by batch creation date
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4 flex-wrap">
            <div className="space-y-2">
              <Label>From</Label>
              <DatePicker
                value={fromDate}
                onChange={(v) => v && setFromDate(v)}
              />
            </div>
            <div className="space-y-2">
              <Label>To</Label>
              <DatePicker
                value={toDate}
                onChange={(v) => v && setToDate(v)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {currentError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error Loading Report</AlertTitle>
          <AlertDescription>
            {currentError instanceof Error
              ? currentError.message
              : "Failed to load COGS data"}
          </AlertDescription>
        </Alert>
      )}

      {/* Tabs */}
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
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-4 w-4" />
                  Avg Cost / BBL
                </CardTitle>
              </CardHeader>
              <CardContent>
                {sharedLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-bold font-mono">
                    {formatCurrency(batchSummary.avgCostPerBbl)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <DollarSign className="h-4 w-4" />
                  Total Material Costs
                </CardTitle>
              </CardHeader>
              <CardContent>
                {sharedLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-bold font-mono">
                    {formatCurrency(batchSummary.totalMaterialCost)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <Hash className="h-4 w-4" />
                  Batches
                </CardTitle>
              </CardHeader>
              <CardContent>
                {sharedLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-bold font-mono">
                    {batchSummary.batchCount}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <Package className="h-4 w-4" />
                  Units Packaged
                </CardTitle>
              </CardHeader>
              <CardContent>
                {sharedLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-bold font-mono">
                    {batchSummary.totalUnitsPackaged.toLocaleString()}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Batch Cost Table */}
          <Card>
            <CardHeader>
              <CardTitle>COGS by Batch</CardTitle>
              <CardDescription>
                Click a row to expand ingredient-level detail
              </CardDescription>
            </CardHeader>
            <CardContent>
              {sharedLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : !batchCostData || batchCostData.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No batches found in the selected date range
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>Batch Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Recipe</TableHead>
                      <TableHead className="text-right">Vol (BBL)</TableHead>
                      <TableHead className="text-right">
                        Ingredient Cost
                      </TableHead>
                      <TableHead className="text-right">
                        Units Packaged
                      </TableHead>
                      <TableHead className="text-right">COGS/Unit</TableHead>
                      <TableHead className="text-right">COGS/BBL</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batchCostData.map((batch) => (
                      <React.Fragment key={batch.id}>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => toggleBatchExpand(batch.id)}
                        >
                          <TableCell className="w-8">
                            {expandedBatchId === batch.id ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </TableCell>
                          <TableCell className="font-mono">
                            {batch.batch_code}
                          </TableCell>
                          <TableCell>{batch.name}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {batch.recipe_name ?? "--"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatBbl(batch.volume_bbl)}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatCurrency(batch.total_ingredient_cost)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {batch.units_packaged.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(batch.cogs_per_unit)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(batch.cost_per_bbl)}
                          </TableCell>
                        </TableRow>

                        {/* Expanded ingredient detail */}
                        {expandedBatchId === batch.id && (
                          <TableRow>
                            <TableCell colSpan={9} className="bg-muted/30 p-0">
                              <div className="px-8 py-4">
                                <h4 className="text-sm font-semibold mb-3">
                                  Ingredient Cost Detail
                                </h4>
                                {detailLoading ? (
                                  <div className="space-y-2">
                                    {[...Array(3)].map((_, i) => (
                                      <Skeleton
                                        key={i}
                                        className="h-8 w-full"
                                      />
                                    ))}
                                  </div>
                                ) : !ingredientDetail ||
                                  ingredientDetail.length === 0 ? (
                                  <p className="text-sm text-muted-foreground">
                                    No ingredient allocations found for this
                                    batch
                                  </p>
                                ) : (
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>Ingredient</TableHead>
                                        <TableHead>Lot #</TableHead>
                                        <TableHead className="text-right">
                                          Quantity
                                        </TableHead>
                                        <TableHead className="text-right">
                                          Unit Cost
                                        </TableHead>
                                        <TableHead className="text-right">
                                          Total Cost
                                        </TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {ingredientDetail.map((row) => (
                                        <TableRow key={row.allocation_id}>
                                          <TableCell>
                                            {row.ingredient_name}
                                          </TableCell>
                                          <TableCell className="text-muted-foreground font-mono text-sm">
                                            {row.lot_number ?? "--"}
                                          </TableCell>
                                          <TableCell className="text-right font-mono">
                                            {row.quantity.toFixed(2)}
                                          </TableCell>
                                          <TableCell className="text-right font-mono">
                                            {formatCurrency(row.unit_cost)}
                                          </TableCell>
                                          <TableCell className="text-right font-mono font-medium">
                                            {formatCurrency(row.total_cost)}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                      <TableRow className="font-bold border-t-2">
                                        <TableCell colSpan={4}>Total</TableCell>
                                        <TableCell className="text-right font-mono">
                                          {formatCurrency(
                                            ingredientDetail.reduce(
                                              (sum, r) => sum + r.total_cost,
                                              0
                                            )
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    </TableBody>
                                  </Table>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================================================================= */}
        {/* Tab 2: By SKU                                                      */}
        {/* ================================================================= */}
        <TabsContent value="by-sku" className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-4 w-4" />
                  Highest Cost SKU
                </CardTitle>
              </CardHeader>
              <CardContent>
                {skuLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : skuSummary.highestCostSku ? (
                  <div>
                    <div className="text-lg font-bold font-mono">
                      {formatCurrency(
                        skuSummary.highestCostSku.avg_cost_per_unit
                      )}
                      <span className="text-xs font-normal text-muted-foreground">
                        {" "}
                        /unit
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                      {skuSummary.highestCostSku.sku_name}
                    </p>
                  </div>
                ) : (
                  <div className="text-2xl font-bold font-mono">--</div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <Package className="h-4 w-4" />
                  Lowest Cost SKU
                </CardTitle>
              </CardHeader>
              <CardContent>
                {skuLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : skuSummary.lowestCostSku ? (
                  <div>
                    <div className="text-lg font-bold font-mono">
                      {formatCurrency(
                        skuSummary.lowestCostSku.avg_cost_per_unit
                      )}
                      <span className="text-xs font-normal text-muted-foreground">
                        {" "}
                        /unit
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                      {skuSummary.lowestCostSku.sku_name}
                    </p>
                  </div>
                ) : (
                  <div className="text-2xl font-bold font-mono">--</div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <DollarSign className="h-4 w-4" />
                  Weighted Avg Cost/Unit
                </CardTitle>
              </CardHeader>
              <CardContent>
                {skuLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-bold font-mono">
                    {formatCurrency(skuSummary.weightedAvgCostPerUnit)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* SKU Table */}
          <Card>
            <CardHeader>
              <CardTitle>COGS by SKU</CardTitle>
              <CardDescription>
                Click a row to see batch breakdown
              </CardDescription>
            </CardHeader>
            <CardContent>
              {skuLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : !skuData || skuData.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No finished goods found in the selected date range
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>SKU</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead>Format</TableHead>
                      <TableHead className="text-right">Batches</TableHead>
                      <TableHead className="text-right">Total Units</TableHead>
                      <TableHead className="text-right">Total Cost</TableHead>
                      <TableHead className="text-right">
                        Avg Cost/Unit
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {skuData.map((sku) => (
                      <React.Fragment key={sku.sku_name}>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => toggleSkuExpand(sku.sku_name)}
                        >
                          <TableCell className="w-8">
                            {expandedSku === sku.sku_name ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </TableCell>
                          <TableCell className="font-medium">
                            {sku.sku_name}
                          </TableCell>
                          <TableCell>{sku.brand_name}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {sku.format_name}
                            {sku.container_name
                              ? ` (${sku.container_name})`
                              : ""}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {sku.batch_count}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {sku.total_units.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatCurrency(sku.total_cost)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(sku.avg_cost_per_unit)}
                          </TableCell>
                        </TableRow>

                        {/* Expanded batch breakdown */}
                        {expandedSku === sku.sku_name && (
                          <TableRow>
                            <TableCell colSpan={8} className="bg-muted/30 p-0">
                              <div className="px-8 py-4">
                                <h4 className="text-sm font-semibold mb-3">
                                  Batch Breakdown
                                </h4>
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Batch Code</TableHead>
                                      <TableHead className="text-right">
                                        Units
                                      </TableHead>
                                      <TableHead className="text-right">
                                        Cost
                                      </TableHead>
                                      <TableHead className="text-right">
                                        Cost/Unit
                                      </TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {sku.batches.map((b) => (
                                      <TableRow key={b.id}>
                                        <TableCell className="font-mono">
                                          {b.batch_code}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                          {b.units.toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                          {formatCurrency(b.cost)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                          {formatCurrency(
                                            b.units > 0
                                              ? b.cost / b.units
                                              : null
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================================================================= */}
        {/* Tab 3: By Period                                                    */}
        {/* ================================================================= */}
        <TabsContent value="by-period" className="space-y-6">
          {/* Granularity selector */}
          <div className="flex items-end gap-4">
            <div className="space-y-2">
              <Label>Granularity</Label>
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
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <DollarSign className="h-4 w-4" />
                  Total COGS
                </CardTitle>
              </CardHeader>
              <CardContent>
                {periodLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-bold font-mono">
                    {formatCurrency(periodSummary.totalCogs)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-4 w-4" />
                  Period-over-Period
                </CardTitle>
              </CardHeader>
              <CardContent>
                {periodLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : periodSummary.periodChange !== null ? (
                  <div
                    className={`text-2xl font-bold font-mono ${periodSummary.periodChange > 0 ? "text-red-600" : "text-green-600"}`}
                  >
                    {periodSummary.periodChange > 0 ? "+" : ""}
                    {periodSummary.periodChange.toFixed(1)}%
                  </div>
                ) : (
                  <div className="text-2xl font-bold font-mono">--</div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <BarChart3 className="h-4 w-4" />
                  Avg COGS / Batch
                </CardTitle>
              </CardHeader>
              <CardContent>
                {periodLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-bold font-mono">
                    {formatCurrency(periodSummary.avgCogsPerBatch)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

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

          {/* Period Table */}
          <Card>
            <CardHeader>
              <CardTitle>Period Detail</CardTitle>
            </CardHeader>
            <CardContent>
              {periodLoading ? (
                <div className="space-y-2">
                  {[...Array(4)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : !periodData || periodData.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No data for the selected date range
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">Total COGS</TableHead>
                      <TableHead className="text-right">Malts</TableHead>
                      <TableHead className="text-right">Hops</TableHead>
                      <TableHead className="text-right">Yeast</TableHead>
                      <TableHead className="text-right">Adjuncts</TableHead>
                      <TableHead className="text-right">Other</TableHead>
                      <TableHead className="text-right">Batches</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {periodData.map((row) => (
                      <TableRow key={row.period}>
                        <TableCell className="font-medium">
                          {row.period}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {formatCurrency(row.total_cogs)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(row.malt_cost)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(row.hop_cost)}
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
                        <TableCell className="text-right font-mono">
                          {row.batch_count}
                        </TableCell>
                      </TableRow>
                    ))}
                    {periodData.length > 1 && (
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
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Disclaimer */}
      <Card className="bg-muted/50">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            <strong>Note:</strong> COGS are derived from allocation records
            linking inventory lots to batches and finished goods packaging
            records. Only allocations with status &quot;completed&quot; or
            &quot;planned&quot; are included. Cost per unit uses proportional
            allocation based on units packaged from each batch.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
