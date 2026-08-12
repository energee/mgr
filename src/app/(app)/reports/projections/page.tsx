"use client";

/**
 * Ingredient Projections Report
 *
 * Shows forward-looking ingredient needs from planned batches and confirmed orders.
 * Compares recipe ingredient requirements against current on-hand inventory
 * to identify shortfalls within a configurable time horizon (30/60/90 days).
 *
 * Features:
 * - Horizon selector (30, 60, 90 days)
 * - Summary cards: total ingredients, at-risk items, batches + orders in window
 * - Combined view sorted by worst shortfall (exportable to CSV via the
 *   header ExportMenu)
 * - By-batch and by-order breakdowns
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { reportKeys } from "@/lib/query-keys";
import { formatDecimal } from "@/lib/format";
import { format, addDays } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Package, ShoppingCart, AlertTriangle } from "lucide-react";
import {
  ReportFilterCard,
  ReportPage,
  ReportSummaryCards,
  ReportTable,
  ReportTableState,
  StatValue,
} from "@/components/reports/report-page";
import {
  groupIngredientsBySource,
  type GroupedIngredientRow,
} from "@/lib/reports/summaries";

// =============================================================================
// Types
// =============================================================================

/** A projected ingredient with needed vs on-hand quantities */
type ProjectedIngredient = {
  name: string;
  category: "malt" | "hop" | "adjunct" | "yeast";
  unit: string;
  neededQty: number;
  onHandQty: number;
  shortfall: number;
  sources: { type: "batch" | "order"; id: string; label: string; qty: number }[];
}

/** A batch within the projection horizon */
type BatchSource = {
  id: string;
  batch_code: string;
  name: string;
  recipe_id: string | null;
  status: string;
  planned_start_date: string | null;
  volume_bbl: number | null;
}

/** An order within the projection horizon */
type OrderSource = {
  id: string;
  order_number: string;
  customer_name: string | null;
  status: string;
  delivery_date: string | null;
}

/** Shape returned from the query function */
type ProjectionData = {
  ingredients: ProjectedIngredient[];
  batches: BatchSource[];
  orders: OrderSource[];
}

// =============================================================================
// Helpers
// =============================================================================

/** Format a numeric quantity to two decimal places, or "--" if null */
const formatQty = formatDecimal;

// =============================================================================
// Component
// =============================================================================

export default function IngredientProjectionsPage() {
  const supabase = createClient();

  const [horizonDays, setHorizonDays] = useState(30);
  const [activeTab, setActiveTab] = useState<"combined" | "by-batch" | "by-order">("combined");

  // ---------------------------------------------------------------------------
  // Fetch projection data
  // ---------------------------------------------------------------------------
  const {
    data: projectionData,
    isLoading,
    error,
  } = useQuery({
    queryKey: reportKeys.projections(horizonDays),
    queryFn: async (): Promise<ProjectionData> => {
      const cutoffDate = format(addDays(new Date(), horizonDays), "yyyy-MM-dd");

      // Steps 1-2: Fetch batches and orders in parallel
      const [batchResult, orderResult] = await Promise.all([
        supabase
          .from("batches")
          .select("id, batch_code, name, status, volume_bbl, planned_start_date, recipe_id, recipes(id, name)")
          .in("status", ["planned", "fermenting"])
          .or(`planned_start_date.lte.${cutoffDate},planned_start_date.is.null`),
        supabase
          .from("orders")
          .select("id, order_number, status, scheduled_date, customers(name)")
          .in("status", ["confirmed", "scheduled", "picking"])
          .or(`scheduled_date.lte.${cutoffDate},scheduled_date.is.null`),
      ]);

      if (batchResult.error) throw batchResult.error;
      if (orderResult.error) throw orderResult.error;

      const batchRows = batchResult.data;
      const orderRows = orderResult.data;

      // Map batch rows into BatchSource[] and collect recipe IDs in a single pass
      const recipeIdSet = new Set<string>();
      const batches: BatchSource[] = (batchRows ?? []).map((b) => {
        if (b.recipe_id) recipeIdSet.add(b.recipe_id);
        return {
          id: b.id,
          batch_code: b.batch_code,
          name: b.name,
          recipe_id: b.recipe_id,
          status: b.status,
          planned_start_date: b.planned_start_date,
          volume_bbl: b.volume_bbl,
        };
      });

      const orders: OrderSource[] = (orderRows ?? []).map((o) => {
        const customer = o.customers as { name: string } | null;
        return {
          id: o.id,
          order_number: o.order_number,
          customer_name: customer?.name ?? null,
          status: o.status,
          delivery_date: o.scheduled_date,
        };
      });

      // Step 4: For orders — find linked batches via order_items and build
      // a recipe_id → orders lookup so we can attribute ingredients to orders.
      const orderIds = orders.map((o) => o.id);
      const orderById = new Map(orders.map((o) => [o.id, o]));
      /** Maps recipe_id → orders that need that recipe (via order_items → batch → recipe). */
      const recipeIdToOrders = new Map<string, OrderSource[]>();

      if (orderIds.length > 0) {
        const { data: orderItemRows } = await supabase
          .from("order_items")
          .select("order_id, batch_id")
          .in("order_id", orderIds)
          .not("batch_id", "is", null);

        if (orderItemRows) {
          const batchIdsFromOrders = orderItemRows
            .map((oi) => oi.batch_id)
            .filter((id): id is string => !!id);

          if (batchIdsFromOrders.length > 0) {
            const { data: orderBatches } = await supabase
              .from("batches")
              .select("id, recipe_id")
              .in("id", batchIdsFromOrders);

            // Map batch_id → recipe_id
            const batchToRecipe = new Map<string, string>();
            for (const ob of orderBatches ?? []) {
              if (ob.recipe_id) {
                recipeIdSet.add(ob.recipe_id);
                batchToRecipe.set(ob.id, ob.recipe_id);
              }
            }

            // Build recipe_id → orders via order_items → batch → recipe
            for (const oi of orderItemRows) {
              if (!oi.batch_id) continue;
              const recipeId = batchToRecipe.get(oi.batch_id);
              const order = orderById.get(oi.order_id);
              if (!recipeId || !order) continue;
              const arr = recipeIdToOrders.get(recipeId) ?? [];
              // Avoid duplicates (same order linked via multiple items)
              if (!arr.some((o) => o.id === order.id)) arr.push(order);
              recipeIdToOrders.set(recipeId, arr);
            }
          }
        }
      }

      const allRecipeIds = Array.from(recipeIdSet);

      if (allRecipeIds.length === 0) {
        return { ingredients: [], batches, orders };
      }

      // Steps 5-6: Fetch recipe ingredients and on-hand inventory in parallel
      const [maltsResult, hopsResult, adjunctsResult, yeastsResult, inventoryResult] = await Promise.all([
        supabase
          .from("recipe_malts")
          .select("recipe_id, weight_lbs, malts(name)")
          .in("recipe_id", allRecipeIds),
        supabase
          .from("recipe_hops")
          .select("recipe_id, weight_oz, hops(name)")
          .in("recipe_id", allRecipeIds),
        supabase
          .from("recipe_adjuncts")
          .select("recipe_id, weight_lbs, adjuncts(name)")
          .in("recipe_id", allRecipeIds),
        supabase
          .from("recipe_yeasts")
          .select("recipe_id, yeasts(name)")
          .in("recipe_id", allRecipeIds),
        supabase
          .from("inventory_lots_with_quantities")
          .select("inventory_item_id, remaining_quantity, unit, inventory_items(name, category)")
          .gt("remaining_quantity", 0),
      ]);

      if (maltsResult.error) throw maltsResult.error;
      if (hopsResult.error) throw hopsResult.error;
      if (adjunctsResult.error) throw adjunctsResult.error;
      if (yeastsResult.error) throw yeastsResult.error;
      if (inventoryResult.error) throw inventoryResult.error;

      const inventoryRows = inventoryResult.data;

      // Step 7: Build ingredient map — aggregate needed quantities by name + category
      type IngKey = string; // "category::name"
      const ingredientMap = new Map<
        IngKey,
        {
          name: string;
          category: "malt" | "hop" | "adjunct" | "yeast";
          unit: string;
          neededQty: number;
          sources: { type: "batch" | "order"; id: string; label: string; qty: number }[];
        }
      >();

      function getOrCreate(
        name: string,
        category: "malt" | "hop" | "adjunct" | "yeast",
        unit: string
      ) {
        const key: IngKey = `${category}::${name}`;
        if (!ingredientMap.has(key)) {
          ingredientMap.set(key, { name, category, unit, neededQty: 0, sources: [] });
        }
        return ingredientMap.get(key)!;
      }

      // Build recipe -> batch lookup
      const recipeIdToBatches = new Map<string, BatchSource[]>();
      for (const b of batches) {
        if (!b.recipe_id) continue;
        const arr = recipeIdToBatches.get(b.recipe_id) ?? [];
        arr.push(b);
        recipeIdToBatches.set(b.recipe_id, arr);
      }

      /** Push batch and order sources for a recipe ingredient into an entry. */
      function addSources(
        entry: ReturnType<typeof getOrCreate>,
        recipeId: string,
        qty: number,
      ) {
        for (const b of recipeIdToBatches.get(recipeId) ?? []) {
          entry.neededQty += qty;
          entry.sources.push({
            type: "batch",
            id: b.id,
            label: `${b.batch_code} - ${b.name}`,
            qty,
          });
        }
        for (const o of recipeIdToOrders.get(recipeId) ?? []) {
          // Don't double-count neededQty — order demand is fulfilled via
          // the linked batch, which was already counted above.
          entry.sources.push({
            type: "order",
            id: o.id,
            label: `${o.order_number}${o.customer_name ? ` - ${o.customer_name}` : ""}`,
            qty,
          });
        }
      }

      // Aggregate malts
      for (const rm of maltsResult.data ?? []) {
        const maltCatalog = rm.malts as { name: string } | null;
        const name = maltCatalog?.name ?? "Unknown Malt";
        const entry = getOrCreate(name, "malt", "lbs");
        addSources(entry, rm.recipe_id, rm.weight_lbs);
      }

      // Aggregate hops
      for (const rh of hopsResult.data ?? []) {
        const hopCatalog = rh.hops as { name: string } | null;
        const name = hopCatalog?.name ?? "Unknown Hop";
        const entry = getOrCreate(name, "hop", "oz");
        addSources(entry, rh.recipe_id, rh.weight_oz);
      }

      // Aggregate adjuncts
      for (const ra of adjunctsResult.data ?? []) {
        const adjunctCatalog = ra.adjuncts as { name: string } | null;
        const name = adjunctCatalog?.name ?? "Unknown Adjunct";
        const entry = getOrCreate(name, "adjunct", "lbs");
        addSources(entry, ra.recipe_id, ra.weight_lbs);
      }

      // Aggregate yeasts using actual quantity from recipe (defaults to 1 if unset).
      // The quantity column is added by migration 00145; until the Supabase types
      // are regenerated we access it via an unknown cast.
      for (const ry of yeastsResult.data ?? []) {
        const yeastCatalog = ry.yeasts as { name: string } | null;
        const name = yeastCatalog?.name ?? "Unknown Yeast";
        const entry = getOrCreate(name, "yeast", "pkg");
        const yeastQty = (ry as unknown as { quantity?: number }).quantity ?? 1;
        addSources(entry, ry.recipe_id, yeastQty);
      }

      // Step 8: Compare against on-hand inventory
      const onHandByName = new Map<string, number>();
      for (const lot of inventoryRows ?? []) {
        const item = lot.inventory_items as { name: string; category: string } | null;
        if (!item) continue;
        const existing = onHandByName.get(item.name) ?? 0;
        onHandByName.set(item.name, existing + (lot.remaining_quantity ?? 0));
      }

      // Step 9: Build final ingredient array
      const ingredients: ProjectedIngredient[] = Array.from(ingredientMap.values()).map(
        (entry) => {
          const onHand = onHandByName.get(entry.name) ?? 0;
          return {
            name: entry.name,
            category: entry.category,
            unit: entry.unit,
            neededQty: entry.neededQty,
            onHandQty: onHand,
            shortfall: onHand - entry.neededQty,
            sources: entry.sources,
          };
        }
      );

      // Sort by shortfall ascending (worst first)
      ingredients.sort((a, b) => a.shortfall - b.shortfall);

      return { ingredients, batches, orders };
    },
  });

  // ---------------------------------------------------------------------------
  // Summary calculations
  // ---------------------------------------------------------------------------
  const summary = useMemo(() => {
    if (!projectionData) {
      return { totalIngredients: 0, atRisk: 0, batchCount: 0, orderCount: 0 };
    }
    return {
      totalIngredients: projectionData.ingredients.length,
      atRisk: projectionData.ingredients.filter((i) => i.shortfall < 0).length,
      batchCount: projectionData.batches.length,
      orderCount: projectionData.orders.length,
    };
  }, [projectionData]);

  // ---------------------------------------------------------------------------
  // Group ingredients by batch / order for the breakdown tabs
  // ---------------------------------------------------------------------------
  const ingredientsByBatch = useMemo(
    () => groupIngredientsBySource(
        projectionData?.ingredients,
        "batch",
        projectionData?.batches ?? []
      ),
    [projectionData],
  );

  const ingredientsByOrder = useMemo(
    () => groupIngredientsBySource(
        projectionData?.ingredients,
        "order",
        projectionData?.orders ?? []
      ),
    [projectionData],
  );

  // ---------------------------------------------------------------------------
  // CSV export rows (mirrors the Combined ingredients table)
  // ---------------------------------------------------------------------------
  const exportRows = useMemo(
    () =>
      (projectionData?.ingredients ?? []).map((ing) => ({
        Ingredient: ing.name,
        Category: ing.category,
        Needed: Number(ing.neededQty.toFixed(2)),
        "On Hand": Number(ing.onHandQty.toFixed(2)),
        Shortfall: Number(ing.shortfall.toFixed(2)),
        Unit: ing.unit,
      })),
    [projectionData]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <ReportPage
      title="Ingredient Projections"
      description="Forward-looking ingredient needs from planned batches and confirmed orders"
      exportConfig={{
        filename: `ingredient-projections-${horizonDays}d.csv`,
        rows: exportRows,
        disabled: isLoading,
      }}
      filter={
        <ReportFilterCard
          title="Projection Horizon"
          description="Select the number of days to look ahead"
        >
          <div className="flex items-center gap-2">
            {[30, 60, 90].map((days) => (
              <Button
                key={days}
                variant={horizonDays === days ? "default" : "outline"}
                onClick={() => setHorizonDays(days)}
              >
                {days} Days
              </Button>
            ))}
          </div>
        </ReportFilterCard>
      }
      error={error}
      errorFallback="Failed to load projection data"
      note="Projections are based on recipe ingredient lists for planned and in-progress batches, and confirmed/scheduled orders. On-hand quantities come from inventory lots with remaining stock. Yeast is counted as 1 package per batch. Actual usage may vary based on batch volume scaling and recipe adjustments."
    >
      <ReportSummaryCards
        loading={isLoading}
        cards={[
          {
            icon: Package,
            label: "Total Ingredients Needed",
            value: <StatValue>{summary.totalIngredients}</StatValue>,
          },
          {
            icon: AlertTriangle,
            label: "At Risk (Shortfall)",
            value: <StatValue>{summary.atRisk}</StatValue>,
          },
          {
            icon: ShoppingCart,
            label: "Batches + Orders in Window",
            value: (
              <StatValue>{summary.batchCount + summary.orderCount}</StatValue>
            ),
          },
        ]}
      />

      {/* Tabs */}
      <Card>
        <CardContent className="pt-6">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as typeof activeTab)}
          >
            <TabsList>
              <TabsTrigger value="combined">Combined</TabsTrigger>
              <TabsTrigger value="by-batch">By Batch</TabsTrigger>
              <TabsTrigger value="by-order">By Order</TabsTrigger>
            </TabsList>

            <TabsContent value="combined">
              <ReportTableState
                loading={isLoading}
                isEmpty={
                  !projectionData || projectionData.ingredients.length === 0
                }
                emptyMessage="No ingredient projections found for the selected horizon"
              >
                <ReportTable
                  rows={projectionData?.ingredients ?? []}
                  rowKey={(ing) => `${ing.category}::${ing.name}`}
                  columns={[
                    {
                      header: "Ingredient",
                      cellClassName: "font-medium",
                      cell: (ing) => ing.name,
                    },
                    {
                      header: "Category",
                      cellClassName: "capitalize text-muted-foreground",
                      cell: (ing) => ing.category,
                    },
                    {
                      header: "Needed",
                      headClassName: "text-right",
                      cellClassName: "text-right font-mono",
                      cell: (ing) => formatQty(ing.neededQty),
                    },
                    {
                      header: "On Hand",
                      headClassName: "text-right",
                      cellClassName: "text-right font-mono",
                      cell: (ing) => formatQty(ing.onHandQty),
                    },
                    {
                      header: "Shortfall",
                      headClassName: "text-right",
                      cellClassName: (ing) =>
                        `text-right font-mono font-medium ${
                          ing.shortfall < 0 ? "text-destructive" : ""
                        }`,
                      cell: (ing) => formatQty(ing.shortfall),
                    },
                    {
                      header: "Unit",
                      cellClassName: "text-muted-foreground",
                      cell: (ing) => ing.unit,
                    },
                  ]}
                />
              </ReportTableState>
            </TabsContent>

            <TabsContent value="by-batch">
              <SourceBreakdown
                loading={isLoading}
                emptyMessage="No batch ingredient projections found"
                groups={ingredientsByBatch.map(({ entity, ingredients }) => ({
                  id: entity.id,
                  heading: `${entity.batch_code} - ${entity.name}`,
                  ingredients,
                }))}
              />
            </TabsContent>

            <TabsContent value="by-order">
              <SourceBreakdown
                loading={isLoading}
                emptyMessage="No order ingredient projections found"
                groups={ingredientsByOrder.map(({ entity, ingredients }) => ({
                  id: entity.id,
                  heading: `${entity.order_number}${
                    entity.customer_name ? ` - ${entity.customer_name}` : ""
                  }`,
                  ingredients,
                }))}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </ReportPage>
  );
}

/**
 * Per-source ingredient breakdown used by the "By Batch" and "By Order" tabs:
 * a heading per source entity followed by its ingredient quantities.
 */
function SourceBreakdown({
  loading,
  emptyMessage,
  groups,
}: {
  loading: boolean;
  emptyMessage: string;
  groups: { id: string; heading: string; ingredients: GroupedIngredientRow[] }[];
}) {
  return (
    <ReportTableState
      loading={loading}
      isEmpty={groups.length === 0}
      emptyMessage={emptyMessage}
    >
      <div className="space-y-6">
        {groups.map((group) => (
          <div key={group.id}>
            <h3 className="text-sm font-semibold mb-2">{group.heading}</h3>
            <ReportTable
              rows={group.ingredients}
              rowKey={(ing, i) => `${group.id}-${ing.name}-${i}`}
              columns={[
                {
                  header: "Ingredient",
                  cellClassName: "font-medium",
                  cell: (ing) => ing.name,
                },
                {
                  header: "Category",
                  cellClassName: "capitalize text-muted-foreground",
                  cell: (ing) => ing.category,
                },
                {
                  header: "Quantity",
                  headClassName: "text-right",
                  cellClassName: "text-right font-mono",
                  cell: (ing) => formatQty(ing.qty),
                },
                {
                  header: "Unit",
                  cellClassName: "text-muted-foreground",
                  cell: (ing) => ing.unit,
                },
              ]}
            />
          </div>
        ))}
      </div>
    </ReportTableState>
  );
}
