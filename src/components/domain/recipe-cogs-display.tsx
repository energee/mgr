"use client";

/**
 * RecipeCOGSDisplay - Recipe Cost of Goods Sold Display
 *
 * Shows ingredient cost breakdown and total COGS for a recipe.
 * Data comes from the recipes_with_cogs view.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { DollarSign, TrendingUp } from "lucide-react";

// =============================================================================
// Types
// =============================================================================

interface RecipeCOGS {
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

interface RecipeCOGSDisplayProps {
  recipeId: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

function formatCurrency(value: number | null): string {
  if (value === null || value === 0) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function CostRow({
  label,
  cost,
  quantity,
  unit,
}: {
  label: string;
  cost: number | null;
  quantity?: number | null;
  unit?: string;
}) {
  const hasCost = cost !== null && cost > 0;
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        <span className="text-sm">{label}</span>
        {quantity !== undefined && quantity !== null && quantity > 0 && (
          <span className="text-xs text-muted-foreground">
            ({quantity.toFixed(1)} {unit})
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
    queryKey: ["recipe-cogs", recipeId],
    queryFn: async () => {
      // Note: recipes_with_cogs view added in migration 00019_recipe_cogs.sql
      // Types will be available after running `npx supabase gen types`
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (query: string) => {
            eq: (col: string, val: string) => {
              single: () => Promise<{ data: RecipeCOGS | null; error: Error | null }>
            }
          }
        }
      }).from("recipes_with_cogs")
        .select("*")
        .eq("id", recipeId)
        .single();

      if (error) throw error;
      return data as RecipeCOGS;
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

  const hasAnyCosts =
    (cogs.malt_cost ?? 0) > 0 ||
    (cogs.hop_cost ?? 0) > 0 ||
    (cogs.yeast_cost ?? 0) > 0 ||
    (cogs.adjunct_cost ?? 0) > 0 ||
    (cogs.addition_cost ?? 0) > 0;

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
            unit="lbs"
          />
          <CostRow
            label="Hops"
            cost={cogs.hop_cost}
            quantity={cogs.total_hop_oz}
            unit="oz"
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
