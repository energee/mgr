"use client";

/**
 * Batch Cost Analysis Report
 *
 * Shows per-batch ingredient cost breakdown derived from allocations,
 * with recipe-level COGS estimates as fallback when allocation data
 * is unavailable.
 *
 * Features:
 * - Date range filtering (default: last 6 months)
 * - Summary cards: avg cost/batch, avg cost/BBL, total production cost
 * - Cost breakdown table per batch (batch #, recipe, brand, volume, costs)
 * - Expandable ingredient-level detail per batch
 *
 * Data sources:
 * - allocations (destination_type = 'batch') for actual ingredient costs
 * - recipes_with_cogs for estimated ingredient costs when allocations are absent
 * - recipes -> brands for brand name resolution
 */

import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { reportKeys } from "@/lib/query-keys";
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
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  DollarSign,
  Hash,
  TrendingUp,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import Link from "next/link";

// =============================================================================
// Types
// =============================================================================

/** A batch with its aggregated cost from allocations or recipe estimates */
interface BatchCostRow {
  id: string;
  batch_number: string;
  name: string;
  recipe_name: string | null;
  brand_name: string | null;
  volume_bbl: number | null;
  ingredient_cost: number;
  total_cost: number;
  cost_per_bbl: number | null;
  status: string;
  /** Whether cost data came from allocations (true) or recipe estimates (false) */
  has_allocation_costs: boolean;
}

/** Individual ingredient allocation cost for a batch */
interface IngredientCostRow {
  allocation_id: string;
  ingredient_name: string;
  quantity: number;
  unit_cost: number | null;
  total_cost: number;
  lot_number: string | null;
}

// =============================================================================
// Helpers
// =============================================================================

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatBbl(value: number | null | undefined): string {
  if (value == null) return "--";
  return value.toFixed(2);
}

// =============================================================================
// Component
// =============================================================================

export default function BatchCostAnalysisPage() {
  const supabase = createClient();

  // Default date range: last 6 months
  const defaultFrom = format(
    startOfMonth(subMonths(new Date(), 6)),
    "yyyy-MM-dd"
  );
  const defaultTo = format(endOfMonth(new Date()), "yyyy-MM-dd");

  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Fetch batches with cost data from allocations + recipe COGS fallback
  // -------------------------------------------------------------------------
  const {
    data: batchCostData,
    isLoading,
    error,
  } = useQuery({
    queryKey: reportKeys.batchCost({ from: fromDate, to: toDate }),
    queryFn: async () => {
      // Step 1: Get batches in date range with recipe and brand info
      const { data: batches, error: batchErr } = await supabase
        .from("batches")
        .select(
          "id, batch_number, name, status, volume_bbl, created_at, recipe:recipes(id, name, brand:brands(name))"
        )
        .gte("created_at", fromDate)
        .lte("created_at", toDate + "T23:59:59Z")
        .not("status", "in", '("cancelled","archived")')
        .order("batch_number", { ascending: true });

      if (batchErr) throw batchErr;
      if (!batches || batches.length === 0) return [];

      const batchIds = batches.map((b) => b.id);

      // Step 2: Get all allocations destined for these batches
      const { data: allocations, error: allocErr } = await supabase
        .from("allocations")
        .select("id, destination_id, quantity, unit_cost, source_id, source_type")
        .eq("destination_type", "batch")
        .in("destination_id", batchIds)
        .in("status", ["completed", "planned"]);

      if (allocErr) throw allocErr;

      // Step 3: Get recipe-level COGS for fallback estimates
      const recipeIds = [
        ...new Set(
          batches
            .map((b) => {
              const recipe = b.recipe as { id: string; name: string; brand: { name: string } | null } | null;
              return recipe?.id;
            })
            .filter(Boolean) as string[]
        ),
      ];

      type RecipeCOGSRow = { id: string; total_cogs: number | null; cogs_per_bbl: number | null };
      const recipeCOGSMap = new Map<string, RecipeCOGSRow>();

      if (recipeIds.length > 0) {
        const { data: cogsData } = await supabase
          .from("recipes_with_cogs" as "recipes")
          .select("id, total_cogs, cogs_per_bbl")
          .in("id", recipeIds);

        if (cogsData) {
          for (const row of cogsData as unknown as RecipeCOGSRow[]) {
            recipeCOGSMap.set(row.id, row);
          }
        }
      }

      // Step 4: Aggregate allocation costs per batch
      const costByBatch = new Map<string, number>();
      for (const alloc of allocations || []) {
        if (!alloc.destination_id) continue;
        const lineCost = alloc.quantity * (alloc.unit_cost ?? 0);
        costByBatch.set(
          alloc.destination_id,
          (costByBatch.get(alloc.destination_id) ?? 0) + lineCost
        );
      }

      // Step 5: Build result rows
      const result: BatchCostRow[] = batches.map((b) => {
        const recipe = b.recipe as { id: string; name: string; brand: { name: string } | null } | null;
        const volumeBbl = b.volume_bbl;

        // Use allocation-based costs if available, otherwise fall back to recipe COGS
        const allocationCost = costByBatch.get(b.id);
        const hasAllocationCosts = allocationCost !== undefined && allocationCost > 0;

        let ingredientCost: number;
        if (hasAllocationCosts) {
          ingredientCost = allocationCost;
        } else if (recipe?.id && recipeCOGSMap.has(recipe.id)) {
          const cogs = recipeCOGSMap.get(recipe.id)!;
          // Scale recipe COGS by batch volume if recipe has per-BBL cost
          if (volumeBbl && volumeBbl > 0 && cogs.cogs_per_bbl) {
            ingredientCost = cogs.cogs_per_bbl * volumeBbl;
          } else {
            ingredientCost = cogs.total_cogs ?? 0;
          }
        } else {
          ingredientCost = 0;
        }

        const totalCost = ingredientCost;

        return {
          id: b.id,
          batch_number: b.batch_number,
          name: b.name,
          recipe_name: recipe?.name ?? null,
          brand_name: recipe?.brand?.name ?? null,
          volume_bbl: volumeBbl,
          ingredient_cost: ingredientCost,
          total_cost: totalCost,
          cost_per_bbl:
            volumeBbl && volumeBbl > 0 ? totalCost / volumeBbl : null,
          status: b.status,
          has_allocation_costs: hasAllocationCosts,
        };
      });

      return result;
    },
  });

  // -------------------------------------------------------------------------
  // Fetch ingredient detail for expanded batch
  // -------------------------------------------------------------------------
  const { data: ingredientDetail, isLoading: detailLoading } = useQuery({
    queryKey: reportKeys.batchCostDetail(expandedBatchId ?? ""),
    queryFn: async () => {
      if (!expandedBatchId) return [];

      // Get allocations for this batch with source lot info
      const { data: allocations, error: allocErr } = await supabase
        .from("allocations")
        .select("id, quantity, unit_cost, source_id, source_type, lot_number")
        .eq("destination_type", "batch")
        .eq("destination_id", expandedBatchId)
        .in("status", ["completed", "planned"]);

      if (allocErr) throw allocErr;
      if (!allocations || allocations.length === 0) return [];

      // Get source lot IDs to look up inventory item names
      const lotIds = allocations
        .filter((a) => a.source_type === "inventory_lot" && a.source_id)
        .map((a) => a.source_id!);

      const lotNameMap = new Map<string, string>();

      if (lotIds.length > 0) {
        const { data: lots } = await supabase
          .from("inventory_lots")
          .select("id, inventory_item:inventory_items(name)")
          .in("id", lotIds);

        if (lots) {
          for (const lot of lots) {
            const item = lot.inventory_item as { name: string } | null;
            if (item) {
              lotNameMap.set(lot.id, item.name);
            }
          }
        }
      }

      const rows: IngredientCostRow[] = allocations.map((a) => ({
        allocation_id: a.id,
        ingredient_name:
          a.source_id && lotNameMap.has(a.source_id)
            ? lotNameMap.get(a.source_id)!
            : a.source_type === "external"
              ? "External"
              : "Unknown",
        quantity: a.quantity,
        unit_cost: a.unit_cost,
        total_cost: a.quantity * (a.unit_cost ?? 0),
        lot_number: a.lot_number,
      }));

      return rows;
    },
    enabled: !!expandedBatchId,
  });

  // -------------------------------------------------------------------------
  // Summary calculations
  // -------------------------------------------------------------------------
  const summary = useMemo(() => {
    if (!batchCostData || batchCostData.length === 0) {
      return {
        avgCostPerBatch: 0,
        avgCostPerBbl: 0,
        totalProductionCost: 0,
        batchCount: 0,
      };
    }

    const totalProductionCost = batchCostData.reduce(
      (sum, b) => sum + b.total_cost,
      0
    );

    const avgCostPerBatch = totalProductionCost / batchCostData.length;

    const batchesWithVolume = batchCostData.filter(
      (b) => b.volume_bbl && b.volume_bbl > 0
    );
    const totalVolume = batchesWithVolume.reduce(
      (sum, b) => sum + (b.volume_bbl ?? 0),
      0
    );
    const avgCostPerBbl =
      totalVolume > 0 ? totalProductionCost / totalVolume : 0;

    return {
      avgCostPerBatch,
      avgCostPerBbl,
      totalProductionCost,
      batchCount: batchCostData.length,
    };
  }, [batchCostData]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------
  function toggleExpand(batchId: string) {
    setExpandedBatchId((prev) => (prev === batchId ? null : batchId));
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
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
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6" />
            Batch Cost Analysis
          </h1>
          <p className="text-muted-foreground">
            Ingredient cost breakdown per production batch
          </p>
        </div>
      </div>

      {/* Date Range */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Date Range</CardTitle>
          <CardDescription>
            Filter batches by creation date
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
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error Loading Report</AlertTitle>
          <AlertDescription>
            {error instanceof Error
              ? error.message
              : "Failed to load batch cost data"}
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <DollarSign className="h-4 w-4" />
              Avg Cost per Batch
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold font-mono">
                {formatCurrency(summary.avgCostPerBatch)}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-4 w-4" />
              Avg Cost per BBL
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold font-mono">
                {formatCurrency(summary.avgCostPerBbl)}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <DollarSign className="h-4 w-4" />
              Total Production Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold font-mono">
                {formatCurrency(summary.totalProductionCost)}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <Hash className="h-4 w-4" />
              Batches Analyzed
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold font-mono">
                {summary.batchCount}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Batch Cost Table */}
      <Card>
        <CardHeader>
          <CardTitle>Cost Breakdown by Batch</CardTitle>
          <CardDescription>
            Click a row to expand ingredient-level detail
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
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
                  <TableHead>Batch #</TableHead>
                  <TableHead>Recipe</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead className="text-right">Volume (BBL)</TableHead>
                  <TableHead className="text-right">
                    Ingredient Cost
                  </TableHead>
                  <TableHead className="text-right">Total Cost</TableHead>
                  <TableHead className="text-right">Cost / BBL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batchCostData.map((batch) => (
                  <React.Fragment key={batch.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => toggleExpand(batch.id)}
                    >
                      <TableCell className="w-8">
                        {expandedBatchId === batch.id ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </TableCell>
                      <TableCell className="font-mono">
                        {batch.batch_number}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {batch.recipe_name ?? "--"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {batch.brand_name ?? "--"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatBbl(batch.volume_bbl)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <span
                          title={
                            batch.has_allocation_costs
                              ? "From allocation records"
                              : "Estimated from recipe COGS"
                          }
                        >
                          {formatCurrency(batch.ingredient_cost)}
                          {!batch.has_allocation_costs &&
                            batch.ingredient_cost > 0 && (
                              <span className="text-xs text-muted-foreground ml-1">
                                *
                              </span>
                            )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {formatCurrency(batch.total_cost)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(batch.cost_per_bbl)}
                      </TableCell>
                    </TableRow>

                    {/* Expanded ingredient detail */}
                    {expandedBatchId === batch.id && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-muted/30 p-0">
                          <div className="px-8 py-4">
                            <h4 className="text-sm font-semibold mb-3">
                              Ingredient Cost Detail
                            </h4>
                            {!batch.has_allocation_costs ? (
                              <p className="text-sm text-muted-foreground">
                                No allocation records for this batch. Cost
                                shown is an estimate from the recipe&apos;s
                                ingredient catalog prices.
                              </p>
                            ) : detailLoading ? (
                              <div className="space-y-2">
                                {[...Array(3)].map((_, i) => (
                                  <Skeleton key={i} className="h-8 w-full" />
                                ))}
                              </div>
                            ) : !ingredientDetail ||
                              ingredientDetail.length === 0 ? (
                              <p className="text-sm text-muted-foreground">
                                No ingredient allocations found for this batch
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

      {/* Disclaimer */}
      <Card className="bg-muted/50">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            <strong>Note:</strong> Costs are primarily derived from allocation
            records linking inventory lots to batches. When no allocations
            exist, ingredient costs are estimated from the recipe&apos;s
            catalog prices (marked with *). Only allocations with status
            &quot;completed&quot; or &quot;planned&quot; are included.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
