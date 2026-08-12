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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DollarSign, Package, Warehouse } from "lucide-react";
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
  aggregateFinishedGoodsValuation,
  aggregateRawMaterials,
  buildBatchCostMap,
  type FinishedGoodDisplayRow,
  type RawMaterialRow,
} from "@/domain/reports/summaries";

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

/** Finished good row from finished_goods_with_availability */
type FinishedGoodRow = {
  id: string | null;
  batch_id: string | null;
  brand_name: string | null;
  selling_format_name: string | null;
  available_quantity: number | null;
  quantity: number | null;
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

      return buildBatchCostMap(batchIds, allocations ?? [], fgRows ?? []);
    },
    enabled: !!finishedGoods && finishedGoods.length > 0,
  });

  // ---------------------------------------------------------------------------
  // Aggregate raw materials by item
  // ---------------------------------------------------------------------------
  const rawMaterialRows = useMemo<RawMaterialRow[]>(
    () => aggregateRawMaterials(rawMaterialLots),
    [rawMaterialLots]
  );

  // ---------------------------------------------------------------------------
  // Aggregate finished goods by brand + package type
  // ---------------------------------------------------------------------------
  const finishedGoodRows = useMemo<FinishedGoodDisplayRow[]>(
    () => aggregateFinishedGoodsValuation(finishedGoods, batchCosts),
    [finishedGoods, batchCosts]
  );

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
    <ReportPage
      title="Inventory Valuation"
      description="Current inventory value by category"
      exportConfig={{
        filename: exportConfig.filename,
        rows: exportConfig.rows,
        disabled: exportConfig.loading,
      }}
      filter={
        <ReportFilterCard
          title="Report Date"
          description="Select the as-of date for the valuation snapshot"
        >
          <ReportField label="As of" htmlFor="as-of-date">
            <Input
              id="as-of-date"
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="w-48"
            />
          </ReportField>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAsOfDate(getTodayString())}
          >
            Today
          </Button>
        </ReportFilterCard>
      }
      error={error}
      errorFallback="Failed to load inventory valuation data"
      note="Raw material values are calculated using the weighted average unit cost from purchase receipts. Finished goods values are estimated from batch ingredient costs divided by total units packaged. All quantities reflect the remaining balance after allocations (planned and completed)."
    >
      <ReportSummaryCards
        loading={isLoading}
        cards={[
          {
            icon: Warehouse,
            label: "Raw Materials",
            value: <StatValue>{formatCurrency(rawMaterialsTotal)}</StatValue>,
            skeletonClassName: "w-28",
          },
          {
            icon: Package,
            label: "Finished Goods",
            value: <StatValue>{formatCurrency(finishedGoodsTotal)}</StatValue>,
            sub: finishedGoodsTotal === 0 && finishedGoodRows.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Unit costs not yet tracked
              </p>
            ),
            skeletonClassName: "w-28",
          },
          {
            icon: DollarSign,
            label: "Grand Total",
            value: <StatValue>{formatCurrency(grandTotal)}</StatValue>,
            sub: finishedGoodRows.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Finished goods valued at estimated ingredient cost per unit
              </p>
            ),
            skeletonClassName: "w-28",
          },
        ]}
      />

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

        <TabsContent value="raw-materials">
          <ReportTableCard
            title="Raw Materials Valuation"
            description={`Inventory lots with remaining quantity as of ${asOfDate}, grouped by item`}
            loading={rawLoading}
            isEmpty={rawMaterialRows.length === 0}
            emptyMessage="No raw material inventory found for this date"
          >
            <ReportTable
              rows={rawMaterialRows}
              rowKey={(r) => `${r.itemName}-${r.unit}`}
              columns={[
                { header: "Item", cellClassName: "pl-6", cell: (r) => r.itemName },
                {
                  header: "Category",
                  cellClassName: "text-muted-foreground text-sm",
                  cell: (r) => capitalize(r.category),
                },
                {
                  header: "Qty on Hand",
                  headClassName: "text-right",
                  cellClassName: "text-right font-mono",
                  cell: (r) => formatQuantity(r.totalQuantity),
                },
                { header: "Unit", cell: (r) => r.unit },
                {
                  header: "Avg Unit Cost",
                  headClassName: "text-right",
                  cellClassName: "text-right font-mono",
                  cell: (r) =>
                    r.avgUnitCost > 0 ? formatCurrency(r.avgUnitCost) : "--",
                },
                {
                  header: "Total Value",
                  headClassName: "text-right",
                  cellClassName: "text-right font-mono",
                  cell: (r) =>
                    r.totalValue > 0 ? formatCurrency(r.totalValue) : "--",
                },
              ]}
              // Category header before the first row of each category, and a
              // category subtotal after the last one.
              renderBeforeRow={(row, i) =>
                (i === 0 || rawMaterialRows[i - 1].category !== row.category) && (
                  <TableRow className="bg-muted/50">
                    <TableCell colSpan={6} className="font-semibold text-sm">
                      {capitalize(row.category)}
                    </TableCell>
                  </TableRow>
                )
              }
              renderAfterRow={(row, i) =>
                (i === rawMaterialRows.length - 1 ||
                  rawMaterialRows[i + 1].category !== row.category) && (
                  <TableRow className="border-t">
                    <TableCell colSpan={5} className="font-medium text-sm pl-6">
                      Subtotal: {capitalize(row.category)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {formatCurrency(categoryTotals.get(row.category) ?? 0)}
                    </TableCell>
                  </TableRow>
                )
              }
              footer={
                <TableRow className="font-bold border-t-2">
                  <TableCell colSpan={5}>Total Raw Materials</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCurrency(rawMaterialsTotal)}
                  </TableCell>
                </TableRow>
              }
            />
          </ReportTableCard>
        </TabsContent>

        <TabsContent value="finished-goods">
          <ReportTableCard
            title="Finished Goods Valuation"
            description={`Packaged products with available quantity as of ${asOfDate}, grouped by brand and package type`}
            loading={fgLoading}
            isEmpty={finishedGoodRows.length === 0}
            emptyMessage="No finished goods inventory found for this date"
            footer={
              finishedGoodRows.length > 0 &&
              finishedGoodsTotal === 0 && (
                <p className="text-sm text-muted-foreground mt-4">
                  No ingredient cost data is available for these finished goods.
                  Ensure batches have ingredient allocations recorded to see cost
                  estimates here.
                </p>
              )
            }
          >
            <ReportTable
              rows={finishedGoodRows}
              rowKey={(r) => `${r.brandName}-${r.packageType}`}
              columns={[
                { header: "Brand", cell: (r) => r.brandName },
                { header: "Package Type", cell: (r) => r.packageType },
                {
                  header: "Quantity",
                  headClassName: "text-right",
                  cellClassName: "text-right font-mono",
                  cell: (r) => formatQuantity(r.quantity, 0),
                },
                {
                  header: "Unit Cost Est.",
                  headClassName: "text-right",
                  cellClassName: "text-right font-mono text-muted-foreground",
                  cell: (r) =>
                    r.unitCostEstimate > 0
                      ? formatCurrency(r.unitCostEstimate)
                      : "--",
                },
                {
                  header: "Total Value",
                  headClassName: "text-right",
                  cellClassName: "text-right font-mono",
                  cell: (r) =>
                    r.totalValue > 0 ? formatCurrency(r.totalValue) : "--",
                },
              ]}
              footer={
                <TableRow className="font-bold border-t-2">
                  <TableCell colSpan={4}>Total Finished Goods</TableCell>
                  <TableCell className="text-right font-mono">
                    {finishedGoodsTotal > 0
                      ? formatCurrency(finishedGoodsTotal)
                      : "--"}
                  </TableCell>
                </TableRow>
              }
            />
          </ReportTableCard>
        </TabsContent>
      </Tabs>
    </ReportPage>
  );
}
