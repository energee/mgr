"use client";

/**
 * BatchCostBreakdown - Plan vs actual cost comparison for a batch
 *
 * Shows planned hot-side cost (from recipes_with_cogs), planned cold-side cost
 * (from recipe_variants_with_costs if linked), and actual cold-side additions
 * (from batch_additions_with_costs). Displays variance in absolute and % terms.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys, recipeVariantKeys, batchAdditionKeys } from "@/lib/query-keys";
import { UnitDisplay } from "@/components/ui/unit-input";
import { formatCurrency } from "@/lib/format";

// =============================================================================
// Types
// =============================================================================

interface RecipeCOGS {
  id: string;
  name: string | null;
  cogs_per_bbl: number | null;
  total_cogs: number | null;
}

interface VariantCosts {
  id: string;
  name: string | null;
  variant_addition_cost: number | null;
  hot_side_cost_per_bbl: number | null;
  est_total_cost: number | null;
}

interface BatchAdditionCost {
  id: string | null;
  estimated_cost: number | null;
}

interface BatchCostBreakdownProps {
  data: {
    id: string;
    recipe_id?: string | null;
    recipe_variant_id?: string | null;
    volume_bbl?: number | null;
    [key: string]: unknown;
  };
}


function CostRow({
  label,
  planned,
  actual,
  volumeBbl,
}: {
  label: string;
  planned: number | null | undefined;
  actual?: number | null;
  volumeBbl?: number | null;
}) {
  const showActual = actual !== undefined;
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm">
        {label}
        {volumeBbl ? (
          <> (<UnitDisplay value={volumeBbl} unitType="volume" />)</>
        ) : null}
      </span>
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium w-24 text-right">
          {formatCurrency(planned)}
        </span>
        {showActual && (
          <span className="text-sm font-medium w-24 text-right">
            {formatCurrency(actual)}
          </span>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export function BatchCostBreakdown({ data }: BatchCostBreakdownProps) {
  const supabase = createClient();
  const recipeId = data.recipe_id;
  const variantId = data.recipe_variant_id;
  const volumeBbl = data.volume_bbl;

  // Fetch recipe COGS (hot-side planned)
  const { data: recipeCogs, isLoading: cogsLoading } = useQuery({
    queryKey: recipeKeys.cogs(recipeId!),
    queryFn: async () => {
      const { data: result, error } = await supabase
        .from("recipes_with_cogs" as "recipes")
        .select("id, name, cogs_per_bbl, total_cogs")
        .eq("id", recipeId!)
        .single();

      if (error) throw error;
      return result as unknown as RecipeCOGS;
    },
    enabled: !!recipeId,
  });

  // Fetch variant costs (cold-side planned) if linked
  const { data: variantCosts } = useQuery({
    queryKey: recipeVariantKeys.costDetail(variantId!),
    queryFn: async () => {
      const { data: result, error } = await supabase
        .from("recipe_variants_with_costs")
        .select("id, name, variant_addition_cost, hot_side_cost_per_bbl, est_total_cost")
        .eq("id", variantId!)
        .single();

      if (error) throw error;
      return result as unknown as VariantCosts;
    },
    enabled: !!variantId,
  });

  // Fetch actual cold-side additions
  const { data: actualAdditions } = useQuery({
    queryKey: batchAdditionKeys.withCosts(data.id),
    queryFn: async () => {
      const { data: result, error } = await supabase
        .from("batch_additions_with_costs")
        .select("id, estimated_cost")
        .eq("batch_id", data.id);

      if (error) throw error;
      return (result || []) as BatchAdditionCost[];
    },
    enabled: !!recipeId,
  });

  // Don't render if no recipe linked
  if (!recipeId) return null;

  // Show nothing while loading
  if (cogsLoading) return null;

  // Calculate costs
  const hotSideCostPerBbl = recipeCogs?.cogs_per_bbl ?? 0;
  const plannedHotSide = volumeBbl ? hotSideCostPerBbl * volumeBbl : (recipeCogs?.total_cogs ?? 0);
  const plannedColdSide = variantCosts?.variant_addition_cost ?? 0;
  const totalPlanned = plannedHotSide + plannedColdSide;

  const actualColdSide = (actualAdditions || []).reduce(
    (sum, a) => sum + (a.estimated_cost ?? 0),
    0
  );
  const totalActual = plannedHotSide + actualColdSide;

  const variance = totalActual - totalPlanned;
  const variancePct = totalPlanned > 0 ? (variance / totalPlanned) * 100 : 0;

  const hasAnyData = plannedHotSide > 0 || plannedColdSide > 0 || actualColdSide > 0;

  if (!hasAnyData) {
    return (
      <div className="text-sm text-muted-foreground">
        No cost data available. Add costs to catalog items to see breakdown.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Column headers */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">Category</span>
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-muted-foreground w-24 text-right">
            Planned
          </span>
          <span className="text-sm font-medium text-muted-foreground w-24 text-right">
            Actual
          </span>
        </div>
      </div>

      {/* Cost rows */}
      <div className="divide-y">
        <CostRow
          label="Hot-side"
          volumeBbl={volumeBbl}
          planned={plannedHotSide}
          actual={plannedHotSide}
        />
        <CostRow
          label="Cold-side additions"
          planned={plannedColdSide}
          actual={actualColdSide}
        />
      </div>

      {/* Totals and variance */}
      <div className="pt-2 border-t space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-medium">Total</span>
          <div className="flex items-center gap-4">
            <span className="text-base font-bold w-24 text-right">
              {formatCurrency(totalPlanned)}
            </span>
            <span className="text-base font-bold w-24 text-right">
              {formatCurrency(totalActual)}
            </span>
          </div>
        </div>

        {variance !== 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Variance</span>
            <span
              className={`font-medium ${
                variance > 0 ? "text-destructive" : "text-green-600"
              }`}
            >
              {variance > 0 ? "+" : ""}
              {formatCurrency(variance)} ({variance > 0 ? "+" : ""}
              {variancePct.toFixed(1)}%)
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
