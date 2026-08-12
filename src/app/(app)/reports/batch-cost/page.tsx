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
 * - CSV export of the cost breakdown table (ExportMenu)
 *
 * Data sources:
 * - allocations (destination_type = 'batch') for actual ingredient costs
 * - recipes_with_cogs for estimated ingredient costs when allocations are absent
 * - recipes -> brands for brand name resolution
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom } from "@/services/types";
import { reportKeys } from "@/lib/query-keys";
import { formatCurrency, formatBbl } from "@/lib/format";
import { fetchBatchIngredientDetail } from "@/domain/report-utils";
import { DollarSign, Hash, TrendingUp } from "lucide-react";
import {
  ExpandChevron,
  ExpandedDetailRow,
  ReportDateRangeFilter,
  ReportPage,
  ReportSummaryCards,
  ReportTable,
  ReportTableCard,
  StatValue,
} from "@/components/reports/report-page";
import { IngredientDetailTable } from "@/components/reports/ingredient-detail-table";
import { computeBatchCostSummary } from "@/lib/reports/summaries";

// =============================================================================
// Types
// =============================================================================

/** A batch with its aggregated cost from allocations or recipe estimates */
type BatchCostRow = {
  id: string;
  batch_code: string;
  name: string;
  recipe_name: string | null;
  brand_name: string | null;
  volume_bbl: number | null;
  ingredient_cost: number;
  cost_per_bbl: number | null;
  status: string;
  /** Whether cost data came from allocations (true) or recipe estimates (false) */
  has_allocation_costs: boolean;
}

/** Shape of the nested recipe join from the batches query. */
type BatchRecipeJoin = { id: string; name: string; brand: { name: string } | null } | null;

// =============================================================================
// Component
// =============================================================================

export default function BatchCostAnalysisPage() {
  const supabase = createClient();

  const [fromDate, setFromDate] = useState(() =>
    format(startOfMonth(subMonths(new Date(), 6)), "yyyy-MM-dd")
  );
  const [toDate, setToDate] = useState(() =>
    format(endOfMonth(new Date()), "yyyy-MM-dd")
  );
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
          "id, batch_code, name, status, volume_bbl, created_at, recipe:recipes(id, name, brand:brands(name))"
        )
        .gte("created_at", fromDate)
        .lte("created_at", toDate + "T23:59:59Z")
        .not("status", "in", '("cancelled","archived")')
        .order("batch_code", { ascending: true });

      if (batchErr) throw batchErr;
      if (!batches || batches.length === 0) return [];

      const batchIds = batches.map((b) => b.id);

      // Steps 2 & 3: Fetch allocations and recipe COGS in parallel
      const recipeIds = [
        ...new Set(
          batches
            .map((b) => {
              const recipe = b.recipe as BatchRecipeJoin;
              return recipe?.id;
            })
            .filter(Boolean) as string[]
        ),
      ];

      const [allocResult, cogsResult] = await Promise.all([
        supabase
          .from("allocations")
          .select("id, destination_id, quantity, unit_cost, source_id, source_type")
          .eq("destination_type", "batch")
          .in("destination_id", batchIds)
          .in("status", ["completed", "planned"]),
        recipeIds.length > 0
          ? dynamicFrom(supabase, "recipes_with_cogs")
              .select("id, total_cogs, cogs_per_bbl")
              .in("id", recipeIds)
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (allocResult.error) throw allocResult.error;
      if (cogsResult.error) throw cogsResult.error;

      const allocations = allocResult.data;

      type RecipeCOGSRow = { id: string; total_cogs: number | null; cogs_per_bbl: number | null };
      const recipeCOGSMap = new Map<string, RecipeCOGSRow>();
      if (cogsResult.data) {
        for (const row of cogsResult.data as unknown as RecipeCOGSRow[]) {
          recipeCOGSMap.set(row.id, row);
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
        const recipe = b.recipe as BatchRecipeJoin;
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

        return {
          id: b.id,
          batch_code: b.batch_code,
          name: b.name,
          recipe_name: recipe?.name ?? null,
          brand_name: recipe?.brand?.name ?? null,
          volume_bbl: volumeBbl,
          ingredient_cost: ingredientCost,
          cost_per_bbl:
            volumeBbl && volumeBbl > 0 ? ingredientCost / volumeBbl : null,
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
    queryFn: () => fetchBatchIngredientDetail(supabase, expandedBatchId),
    enabled: !!expandedBatchId,
  });

  // -------------------------------------------------------------------------
  // Summary calculations
  // -------------------------------------------------------------------------
  const summary = useMemo(
    () => computeBatchCostSummary(batchCostData),
    [batchCostData]
  );

  // -------------------------------------------------------------------------
  // CSV export rows (mirrors the visible cost breakdown table)
  // -------------------------------------------------------------------------
  const exportRows = useMemo(
    () =>
      (batchCostData ?? []).map((b) => ({
        "Batch Code": b.batch_code,
        Recipe: b.recipe_name,
        Brand: b.brand_name,
        "Volume (BBL)": b.volume_bbl,
        "Ingredient Cost": Number(b.ingredient_cost.toFixed(2)),
        "Cost / BBL":
          b.cost_per_bbl !== null ? Number(b.cost_per_bbl.toFixed(2)) : null,
        "Cost Source": b.has_allocation_costs
          ? "Allocations"
          : "Recipe estimate",
      })),
    [batchCostData]
  );

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
    <ReportPage
      title="Batch Cost Analysis"
      description="Ingredient cost breakdown per production batch"
      exportConfig={{
        filename: `batch-cost-${fromDate}-to-${toDate}.csv`,
        rows: exportRows,
        disabled: isLoading,
      }}
      filter={
        <ReportDateRangeFilter
          description="Filter batches by creation date"
          fromDate={fromDate}
          toDate={toDate}
          onFromDateChange={setFromDate}
          onToDateChange={setToDate}
        />
      }
      error={error}
      errorFallback="Failed to load batch cost data"
      note={
        <>
          Costs are primarily derived from allocation records linking inventory
          lots to batches. When no allocations exist, ingredient costs are
          estimated from the recipe&apos;s catalog prices (marked with *). Only
          allocations with status &quot;completed&quot; or &quot;planned&quot;
          are included.
        </>
      }
    >
      <ReportSummaryCards
        loading={isLoading}
        columns={4}
        cards={[
          {
            icon: DollarSign,
            label: "Avg Cost per Batch",
            value: <StatValue>{formatCurrency(summary.avgCostPerBatch)}</StatValue>,
          },
          {
            icon: TrendingUp,
            label: "Avg Cost per BBL",
            value: <StatValue>{formatCurrency(summary.avgCostPerBbl)}</StatValue>,
          },
          {
            icon: DollarSign,
            label: "Total Production Cost",
            value: (
              <StatValue>{formatCurrency(summary.totalProductionCost)}</StatValue>
            ),
          },
          {
            icon: Hash,
            label: "Batches Analyzed",
            value: <StatValue>{summary.batchCount}</StatValue>,
          },
        ]}
      />

      <ReportTableCard
        title="Cost Breakdown by Batch"
        description="Click a row to expand ingredient-level detail"
        loading={isLoading}
        isEmpty={!batchCostData || batchCostData.length === 0}
        emptyMessage="No batches found in the selected date range"
      >
        <ReportTable
          rows={batchCostData ?? []}
          rowKey={(b) => b.id}
          rowClassName="cursor-pointer hover:bg-muted/50"
          onRowClick={(b) => toggleExpand(b.id)}
          columns={[
            {
              header: "",
              headClassName: "w-8",
              cellClassName: "w-8",
              cell: (b) => <ExpandChevron expanded={expandedBatchId === b.id} />,
            },
            {
              header: "Batch Code",
              cellClassName: "font-mono",
              cell: (b) => b.batch_code,
            },
            {
              header: "Recipe",
              cellClassName: "text-muted-foreground",
              cell: (b) => b.recipe_name ?? "--",
            },
            {
              header: "Brand",
              cellClassName: "text-muted-foreground",
              cell: (b) => b.brand_name ?? "--",
            },
            {
              header: "Volume (BBL)",
              headClassName: "text-right",
              cellClassName: "text-right font-mono",
              cell: (b) => formatBbl(b.volume_bbl),
            },
            {
              header: "Ingredient Cost",
              headClassName: "text-right",
              cellClassName: "text-right font-mono",
              cell: (b) => (
                <span
                  title={
                    b.has_allocation_costs
                      ? "From allocation records"
                      : "Estimated from recipe COGS"
                  }
                >
                  {formatCurrency(b.ingredient_cost)}
                  {!b.has_allocation_costs && b.ingredient_cost > 0 && (
                    <span className="text-xs text-muted-foreground ml-1">*</span>
                  )}
                </span>
              ),
            },
            {
              header: "Cost / BBL",
              headClassName: "text-right",
              cellClassName: "text-right font-mono",
              cell: (b) => formatCurrency(b.cost_per_bbl),
            },
          ]}
          renderAfterRow={(b) =>
            expandedBatchId === b.id && (
              <ExpandedDetailRow colSpan={7} title="Ingredient Cost Detail">
                {!b.has_allocation_costs ? (
                  <p className="text-sm text-muted-foreground">
                    No allocation records for this batch. Cost shown is an
                    estimate from the recipe&apos;s ingredient catalog prices.
                  </p>
                ) : (
                  <IngredientDetailTable
                    loading={detailLoading}
                    rows={ingredientDetail}
                  />
                )}
              </ExpandedDetailRow>
            )
          }
        />
      </ReportTableCard>
    </ReportPage>
  );
}
