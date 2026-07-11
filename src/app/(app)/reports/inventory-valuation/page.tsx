"use client";

/**
 * Inventory Valuation Report Page
 *
 * Shows the monetary value of all on-hand inventory as of a selected date.
 * Broken into two sections:
 *   - Raw Materials: sourced from inventory_lots_with_quantities joined
 *     to inventory_items, grouped by item.
 *   - Finished Goods: sourced from finished_goods_with_availability joined
 *     to brands and package_types, grouped by brand + package.
 *
 * Values are calculated as remaining_quantity * unit_cost (raw materials)
 * and available_quantity * unit_cost estimate (finished goods).
 *
 * The header ExportMenu downloads a CSV of whichever tab's table is active.
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { reportKeys } from "@/lib/query-keys";
import { unwrap } from "@/lib/supabase/query-helpers";
import { formatCurrency } from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ArrowLeft,
  DollarSign,
  AlertCircle,
  Package,
  Warehouse,
} from "lucide-react";
import { ExportMenu } from "@/components/reports/export-menu";
import Link from "next/link";

// =============================================================================
// Types
// =============================================================================

/** Raw material lot row from inventory_lots_with_quantities + inventory_items */
type RawMaterialLot = {
  id: string | null;
  inventory_item_id: string | null;
  remaining_quantity: number | null;
  unit: string | null;
  unit_cost: number | null;
  inventory_items: {
    name: string;
    category: string;
  } | null;
}

/** Aggregated raw material row for display */
type RawMaterialRow = {
  itemName: string;
  category: string;
  totalQuantity: number;
  unit: string;
  avgUnitCost: number;
  totalValue: number;
}

/** Finished good row from finished_goods_with_availability */
type FinishedGoodRow = {
  id: string | null;
  batch_id: string | null;
  brand_name: string | null;
  selling_format_name: string | null;
  available_quantity: number | null;
  quantity: number | null;
}

/** Aggregated finished good row for display */
type FinishedGoodDisplayRow = {
  brandName: string;
  packageType: string;
  quantity: number;
  /** Estimated unit cost derived from batch ingredient costs */
  unitCostEstimate: number;
  totalValue: number;
}

// =============================================================================
// Helper Functions
// =============================================================================

/** Format a number with commas and optional decimal places */
function formatQuantity(value: number, decimals = 2): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Get today's date as YYYY-MM-DD */
function getTodayString(): string {
  return new Date().toISOString().split("T")[0];
}

/** Capitalize the first letter of a string */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// =============================================================================
// Component
// =============================================================================

export default function InventoryValuationPage() {
  const supabase = createClient();
  const [asOfDate, setAsOfDate] = useState(getTodayString());
  // Controlled so the header ExportMenu can export the visible tab's table.
  const [activeTab, setActiveTab] = useState<"raw-materials" | "finished-goods">(
    "raw-materials"
  );

  // ---------------------------------------------------------------------------
  // Raw Materials Query
  // ---------------------------------------------------------------------------
  const {
    data: rawMaterialLots,
    isLoading: rawLoading,
    error: rawError,
  } = useQuery({
    queryKey: reportKeys.inventoryValuationRaw(asOfDate),
    queryFn: async () => {
      // Fetch lots with remaining quantities, joined to item details.
      // The view already calculates remaining_quantity from allocations.
      return await unwrap(
        supabase
          .from("inventory_lots_with_quantities")
          .select(
            "id, inventory_item_id, remaining_quantity, unit, unit_cost, inventory_items(name, category)"
          )
          .gt("remaining_quantity", 0)
          .lte("received_date", asOfDate)
      ) as unknown as RawMaterialLot[];
    },
  });

  // ---------------------------------------------------------------------------
  // Finished Goods Query
  // ---------------------------------------------------------------------------
  const {
    data: finishedGoods,
    isLoading: fgLoading,
    error: fgError,
  } = useQuery({
    queryKey: reportKeys.inventoryValuationFinishedGoods(asOfDate),
    queryFn: async () => {
      return await unwrap(
        supabase
          .from("finished_goods_with_availability")
          .select(
            "id, batch_id, brand_name, selling_format_name, available_quantity, quantity"
          )
          .gt("available_quantity", 0)
          .lte("production_date", asOfDate)
      ) as unknown as FinishedGoodRow[];
    },
  });

  // ---------------------------------------------------------------------------
  // Batch Costs Query (for FG valuation)
  // ---------------------------------------------------------------------------
  // Fetch ingredient costs per batch from allocations so that finished goods
  // can be valued at their actual production cost rather than $0.
  const {
    data: batchCosts,
  } = useQuery({
    queryKey: reportKeys.inventoryValuationBatchCosts(asOfDate),
    queryFn: async () => {
      // Get unique batch IDs from finished goods
      const batchIds = [...new Set(
        (finishedGoods ?? [])
          .map((fg) => fg.batch_id)
          .filter((id): id is string => !!id),
      )];
      if (batchIds.length === 0) return new Map<string, { totalCost: number; totalUnits: number }>();

      // Fetch allocation costs and FG unit counts per batch in parallel
      const [{ data: allocations }, { data: fgRows }] = await Promise.all([
        supabase
          .from("allocations")
          .select("destination_id, quantity, unit_cost")
          .eq("destination_type", "batch")
          .in("destination_id", batchIds)
          .in("status", ["completed", "planned"]),
        supabase
          .from("finished_goods")
          .select("batch_id, quantity")
          .in("batch_id", batchIds),
      ]);

      // Sum costs per batch
      const costMap = new Map<string, number>();
      for (const a of allocations ?? []) {
        if (!a.destination_id) continue;
        const lineCost = (a.quantity ?? 0) * (a.unit_cost ?? 0);
        costMap.set(a.destination_id, (costMap.get(a.destination_id) ?? 0) + lineCost);
      }

      // Sum total FG units per batch
      const unitsMap = new Map<string, number>();
      for (const fg of fgRows ?? []) {
        if (!fg.batch_id) continue;
        unitsMap.set(fg.batch_id, (unitsMap.get(fg.batch_id) ?? 0) + (fg.quantity ?? 0));
      }

      // Combine into cost-per-unit map
      const result = new Map<string, { totalCost: number; totalUnits: number }>();
      for (const batchId of batchIds) {
        result.set(batchId, {
          totalCost: costMap.get(batchId) ?? 0,
          totalUnits: unitsMap.get(batchId) ?? 0,
        });
      }
      return result;
    },
    enabled: !!finishedGoods && finishedGoods.length > 0,
  });

  // ---------------------------------------------------------------------------
  // Aggregate raw materials by item
  // ---------------------------------------------------------------------------
  const rawMaterialRows = useMemo<RawMaterialRow[]>(() => {
    if (!rawMaterialLots) return [];

    const grouped = new Map<
      string,
      {
        itemName: string;
        category: string;
        totalQuantity: number;
        unit: string;
        totalCost: number;
        lotCount: number;
      }
    >();

    for (const lot of rawMaterialLots) {
      const itemId = lot.inventory_item_id ?? "unknown";
      const remaining = lot.remaining_quantity ?? 0;
      const cost = lot.unit_cost ?? 0;
      const existing = grouped.get(itemId);

      if (existing) {
        existing.totalQuantity += remaining;
        existing.totalCost += remaining * cost;
        existing.lotCount += 1;
      } else {
        grouped.set(itemId, {
          itemName: lot.inventory_items?.name ?? "Unknown Item",
          category: lot.inventory_items?.category ?? "other",
          totalQuantity: remaining,
          unit: lot.unit ?? "",
          totalCost: remaining * cost,
          lotCount: 1,
        });
      }
    }

    return Array.from(grouped.values())
      .map((item) => ({
        itemName: item.itemName,
        category: item.category,
        totalQuantity: item.totalQuantity,
        unit: item.unit,
        avgUnitCost:
          item.totalQuantity > 0
            ? item.totalCost / item.totalQuantity
            : 0,
        totalValue: item.totalCost,
      }))
      .sort((a, b) => a.category.localeCompare(b.category) || a.itemName.localeCompare(b.itemName));
  }, [rawMaterialLots]);

  // ---------------------------------------------------------------------------
  // Aggregate finished goods by brand + package type
  // ---------------------------------------------------------------------------
  const finishedGoodRows = useMemo<FinishedGoodDisplayRow[]>(() => {
    if (!finishedGoods) return [];

    const grouped = new Map<
      string,
      { brandName: string; packageType: string; quantity: number; totalValue: number }
    >();

    for (const fg of finishedGoods) {
      const key = `${fg.brand_name ?? "Unknown"}::${fg.selling_format_name ?? "Unknown"}`;
      const available = fg.available_quantity ?? 0;

      // Calculate per-unit cost from batch ingredient costs
      let unitCost = 0;
      if (fg.batch_id && batchCosts) {
        const batchInfo = batchCosts.get(fg.batch_id);
        if (batchInfo && batchInfo.totalUnits > 0) {
          unitCost = batchInfo.totalCost / batchInfo.totalUnits;
        }
      }

      const existing = grouped.get(key);
      if (existing) {
        existing.quantity += available;
        existing.totalValue += available * unitCost;
      } else {
        grouped.set(key, {
          brandName: fg.brand_name ?? "Unknown",
          packageType: fg.selling_format_name ?? "Unknown",
          quantity: available,
          totalValue: available * unitCost,
        });
      }
    }

    // Unit cost is derived from batch ingredient costs allocated proportionally
    // across all finished goods produced from that batch.
    return Array.from(grouped.values())
      .map((item) => ({
        brandName: item.brandName,
        packageType: item.packageType,
        quantity: item.quantity,
        unitCostEstimate: item.quantity > 0 ? item.totalValue / item.quantity : 0,
        totalValue: item.totalValue,
      }))
      .sort((a, b) => a.brandName.localeCompare(b.brandName) || a.packageType.localeCompare(b.packageType));
  }, [finishedGoods, batchCosts]);

  // ---------------------------------------------------------------------------
  // Totals
  // ---------------------------------------------------------------------------
  const rawMaterialsTotal = rawMaterialRows.reduce(
    (sum, r) => sum + r.totalValue,
    0
  );
  const finishedGoodsTotal = finishedGoodRows.reduce(
    (sum, r) => sum + r.totalValue,
    0
  );
  const grandTotal = rawMaterialsTotal + finishedGoodsTotal;

  const isLoading = rawLoading || fgLoading;
  // Only show error banner when query failed AND returned no data
  const rawFailed = rawError && !rawMaterialLots;
  const fgFailed = fgError && !finishedGoods;
  const error = rawFailed ? rawError : fgFailed ? fgError : null;

  // ---------------------------------------------------------------------------
  // Category subtotals for raw materials
  // ---------------------------------------------------------------------------
  const categoryTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rawMaterialRows) {
      map.set(row.category, (map.get(row.category) ?? 0) + row.totalValue);
    }
    return map;
  }, [rawMaterialRows]);

  // ---------------------------------------------------------------------------
  // CSV export: mirrors whichever tab's table is currently visible
  // ---------------------------------------------------------------------------
  const exportConfig = useMemo(() => {
    if (activeTab === "finished-goods") {
      return {
        filename: `inventory-valuation-finished-goods-${asOfDate}.csv`,
        loading: fgLoading,
        rows: finishedGoodRows.map((r) => ({
          Brand: r.brandName,
          "Package Type": r.packageType,
          Quantity: r.quantity,
          "Unit Cost Est.": Number(r.unitCostEstimate.toFixed(4)),
          "Total Value": Number(r.totalValue.toFixed(2)),
        })),
      };
    }
    return {
      filename: `inventory-valuation-raw-materials-${asOfDate}.csv`,
      loading: rawLoading,
      rows: rawMaterialRows.map((r) => ({
        Item: r.itemName,
        Category: capitalize(r.category),
        "Qty on Hand": Number(r.totalQuantity.toFixed(2)),
        Unit: r.unit,
        "Avg Unit Cost": Number(r.avgUnitCost.toFixed(4)),
        "Total Value": Number(r.totalValue.toFixed(2)),
      })),
    };
  }, [activeTab, asOfDate, fgLoading, finishedGoodRows, rawLoading, rawMaterialRows]);

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
            Inventory Valuation
          </h1>
          <p className="text-muted-foreground">
            Current inventory value by category
          </p>
        </div>
        <ExportMenu
          filename={exportConfig.filename}
          rows={exportConfig.rows}
          disabled={exportConfig.loading}
        />
      </div>

      {/* As-of Date Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Report Date</CardTitle>
          <CardDescription>
            Select the as-of date for the valuation snapshot
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4">
            <div className="space-y-2">
              <Label htmlFor="as-of-date">As of</Label>
              <Input
                id="as-of-date"
                type="date"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                className="w-48"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAsOfDate(getTodayString())}
            >
              Today
            </Button>
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
              : "Failed to load inventory valuation data"}
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <Warehouse className="h-4 w-4" />
              Raw Materials
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-28" />
            ) : (
              <div className="text-2xl font-bold font-mono">
                {formatCurrency(rawMaterialsTotal)}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <Package className="h-4 w-4" />
              Finished Goods
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-28" />
            ) : (
              <div className="text-2xl font-bold font-mono">
                {formatCurrency(finishedGoodsTotal)}
              </div>
            )}
            {!isLoading && finishedGoodsTotal === 0 && finishedGoodRows.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Unit costs not yet tracked
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <DollarSign className="h-4 w-4" />
              Grand Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-28" />
            ) : (
              <div className="text-2xl font-bold font-mono">
                {formatCurrency(grandTotal)}
              </div>
            )}
            {!isLoading && finishedGoodRows.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Finished goods valued at estimated ingredient cost per unit
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabbed Detail Tables */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as typeof activeTab)}
      >
        <TabsList>
          <TabsTrigger value="raw-materials">
            Raw Materials ({rawMaterialRows.length})
          </TabsTrigger>
          <TabsTrigger value="finished-goods">
            Finished Goods ({finishedGoodRows.length})
          </TabsTrigger>
        </TabsList>

        {/* Raw Materials Tab */}
        <TabsContent value="raw-materials">
          <Card>
            <CardHeader>
              <CardTitle>Raw Materials Valuation</CardTitle>
              <CardDescription>
                Inventory lots with remaining quantity as of {asOfDate},
                grouped by item
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rawLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : rawMaterialRows.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No raw material inventory found for this date
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Qty on Hand</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">
                        Avg Unit Cost
                      </TableHead>
                      <TableHead className="text-right">Total Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rawMaterialRows.map((row, i) => {
                      // Insert category subtotal row when category changes
                      const prevCategory =
                        i > 0 ? rawMaterialRows[i - 1].category : null;
                      const showCategoryHeader =
                        row.category !== prevCategory;
                      const isLastInCategory =
                        i === rawMaterialRows.length - 1 ||
                        rawMaterialRows[i + 1].category !== row.category;

                      return (
                        <CategoryRowGroup
                          key={`${row.itemName}-${row.unit}`}
                          row={row}
                          showCategoryHeader={showCategoryHeader}
                          isLastInCategory={isLastInCategory}
                          categoryTotal={categoryTotals.get(row.category) ?? 0}
                        />
                      );
                    })}
                    {/* Grand total */}
                    <TableRow className="font-bold border-t-2">
                      <TableCell colSpan={5}>Total Raw Materials</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(rawMaterialsTotal)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Finished Goods Tab */}
        <TabsContent value="finished-goods">
          <Card>
            <CardHeader>
              <CardTitle>Finished Goods Valuation</CardTitle>
              <CardDescription>
                Packaged products with available quantity as of {asOfDate},
                grouped by brand and package type
              </CardDescription>
            </CardHeader>
            <CardContent>
              {fgLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : finishedGoodRows.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No finished goods inventory found for this date
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Brand</TableHead>
                      <TableHead>Package Type</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">
                        Unit Cost Est.
                      </TableHead>
                      <TableHead className="text-right">Total Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {finishedGoodRows.map((row) => (
                      <TableRow key={`${row.brandName}-${row.packageType}`}>
                        <TableCell>{row.brandName}</TableCell>
                        <TableCell>{row.packageType}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatQuantity(row.quantity, 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {row.unitCostEstimate > 0
                            ? formatCurrency(row.unitCostEstimate)
                            : "--"}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {row.totalValue > 0
                            ? formatCurrency(row.totalValue)
                            : "--"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {/* Total */}
                    <TableRow className="font-bold border-t-2">
                      <TableCell colSpan={4}>Total Finished Goods</TableCell>
                      <TableCell className="text-right font-mono">
                        {finishedGoodsTotal > 0
                          ? formatCurrency(finishedGoodsTotal)
                          : "--"}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
              {finishedGoodRows.length > 0 && finishedGoodsTotal === 0 && (
                <p className="text-sm text-muted-foreground mt-4">
                  No ingredient cost data is available for these finished goods.
                  Ensure batches have ingredient allocations recorded to see
                  cost estimates here.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Disclaimer */}
      <Card className="bg-muted/50">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            <strong>Note:</strong> Raw material values are calculated using the
            weighted average unit cost from purchase receipts. Finished goods
            values are estimated from batch ingredient costs divided by total
            units packaged. All quantities reflect the remaining balance after
            allocations (planned and completed).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// Category Row Group Sub-component
// =============================================================================

/**
 * Renders a raw material row, optionally preceded by a category header
 * and followed by a category subtotal.
 */
function CategoryRowGroup({
  row,
  showCategoryHeader,
  isLastInCategory,
  categoryTotal,
}: {
  row: RawMaterialRow;
  showCategoryHeader: boolean;
  isLastInCategory: boolean;
  categoryTotal: number;
}) {
  return (
    <>
      {showCategoryHeader && (
        <TableRow className="bg-muted/50">
          <TableCell colSpan={6} className="font-semibold text-sm">
            {capitalize(row.category)}
          </TableCell>
        </TableRow>
      )}
      <TableRow>
        <TableCell className="pl-6">{row.itemName}</TableCell>
        <TableCell className="text-muted-foreground text-sm">
          {capitalize(row.category)}
        </TableCell>
        <TableCell className="text-right font-mono">
          {formatQuantity(row.totalQuantity)}
        </TableCell>
        <TableCell>{row.unit}</TableCell>
        <TableCell className="text-right font-mono">
          {row.avgUnitCost > 0 ? formatCurrency(row.avgUnitCost) : "--"}
        </TableCell>
        <TableCell className="text-right font-mono">
          {row.totalValue > 0 ? formatCurrency(row.totalValue) : "--"}
        </TableCell>
      </TableRow>
      {isLastInCategory && (
        <TableRow className="border-t">
          <TableCell colSpan={5} className="font-medium text-sm pl-6">
            Subtotal: {capitalize(row.category)}
          </TableCell>
          <TableCell className="text-right font-mono font-medium">
            {formatCurrency(categoryTotal)}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
