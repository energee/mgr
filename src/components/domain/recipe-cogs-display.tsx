"use client";

/**
 * RecipeCOGSDisplay - Recipe Cost of Goods Sold Display
 *
 * Shows ingredient cost breakdown and total COGS for a recipe.
 * Data comes from the recipes_with_cogs view.
 *
 * This is a domain component rather than using the universal entity system because:
 * - COGS data is supplementary display-only information, not a primary entity
 * - The cost breakdown UI has specialized rendering needs (grouped categories, totals)
 * - It's embedded within the recipe detail view, not a standalone entity list/detail
 *
 * Note: Component uses "COGS" (all caps) as it's a standard accounting acronym.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { DollarSign, TrendingUp } from "lucide-react";
import { recipeKeys } from "@/lib/query-keys";
import { UnitDisplay } from "@/components/ui/unit-input";
import { formatCurrency } from "@/lib/format";

// =============================================================================
// Types
// =============================================================================

type RecipeCOGS = {
  id: string;
  name: string;
  volume_bbl: number | null;
  batch_size_bbl: number | null;
  malt_cost: number | null;
  hop_cost: number | null;
  yeast_cost: number | null;
  adjunct_cost: number | null;
  addition_cost: number | null;
  total_cogs: number | null;
  cogs_per_bbl: number | null;
  total_grain_lbs: number | null;
  total_hop_oz: number | null;
}

type RecipeCOGSDisplayProps = {
  recipeId: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

function CostRow({
  label,
  cost,
  quantity,
  unitType,
}: {
  label: string;
  cost: number | null;
  quantity?: number | null;
  unitType?: "weight" | "volume" | "temperature";
}) {
  const hasCost = cost !== null && cost > 0;
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        <span className="text-sm">{label}</span>
        {quantity !== undefined && quantity !== null && quantity > 0 && unitType && (
          <span className="text-xs text-muted-foreground">
            (<UnitDisplay value={quantity} unitType={unitType} decimals={1} />)
          </span>
        )}
      </div>
      <span className={`text-sm font-medium ${hasCost ? "" : "text-muted-foreground"}`}>
        {formatCurrency(cost)}
      </span>
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export function RecipeCOGSDisplay({ recipeId }: RecipeCOGSDisplayProps) {
  const supabase = createClient();

  const { data: cogs, isLoading, error } = useQuery({
    queryKey: recipeKeys.cogs(recipeId),
    queryFn: async () => {
      // Generated types exist (Database["public"]["Views"]["recipes_with_cogs"]["Row"])
      // but mark `id` as nullable (view column). Manual interface used for stricter typing.
      const { data, error } = await supabase
        .from("recipes_with_cogs" as "recipes")
        .select("*")
        .eq("id", recipeId)
        .single();

      if (error) throw error;
      return data as unknown as RecipeCOGS;
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Cost of Goods
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !cogs) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Cost of Goods
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            Unable to load cost data
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasAnyCosts = [
    cogs.malt_cost,
    cogs.hop_cost,
    cogs.yeast_cost,
    cogs.adjunct_cost,
    cogs.addition_cost,
  ].some((cost) => cost !== null && cost > 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <DollarSign className="h-4 w-4" />
          Cost of Goods
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Cost Breakdown */}
        <div className="divide-y">
          <CostRow
            label="Malt/Grain"
            cost={cogs.malt_cost}
            quantity={cogs.total_grain_lbs}
            unitType="weight"
          />
          <CostRow
            label="Hops"
            cost={cogs.hop_cost}
            quantity={cogs.total_hop_oz != null ? cogs.total_hop_oz / 16 : null}
            unitType="weight"
          />
          <CostRow label="Yeast" cost={cogs.yeast_cost} />
          <CostRow label="Adjuncts" cost={cogs.adjunct_cost} />
          <CostRow label="Additions" cost={cogs.addition_cost} />
        </div>

        {/* Totals */}
        <div className="pt-2 border-t space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">Total COGS</span>
            <span className="text-lg font-bold">
              {formatCurrency(cogs.total_cogs)}
            </span>
          </div>

          {cogs.cogs_per_bbl !== null && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                Per BBL
              </span>
              <Badge variant="secondary">{formatCurrency(cogs.cogs_per_bbl)}/BBL</Badge>
            </div>
          )}
        </div>

        {/* Empty State */}
        {!hasAnyCosts && (
          <div className="text-sm text-muted-foreground text-center py-2">
            No ingredient costs entered. Add costs to catalog items to see COGS.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
