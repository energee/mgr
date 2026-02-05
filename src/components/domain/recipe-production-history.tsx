"use client";

/**
 * RecipeProductionHistory - Display all batches produced from a recipe
 *
 * Shows performance summary (total batches, avg OG, variance) and a table
 * of all batches with brew date, status, actual OG, and volume.
 */

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { entityKeys, recipeVariantKeys } from "@/lib/query-keys";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/universal/status-badge";
import { batchEntity } from "@/entities/batch";
import { BarChart3, TrendingUp } from "lucide-react";

interface RecipeProductionHistoryProps {
  data: { id: string; est_og?: number | null; [key: string]: unknown };
}

export function RecipeProductionHistory({
  data,
}: RecipeProductionHistoryProps) {
  const recipeId = data.id;
  const estOg = data.est_og;

  const { data: batches, isLoading: batchesLoading } = useQuery({
    queryKey: entityKeys.related("recipes", recipeId, "batches"),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("batches_with_brew_info")
        .select(
          "id, batch_number, name, status, brew_date, actual_og, volume_bbl, volume_from_brews_bbl, recipe_variant_id"
        )
        .eq("recipe_id", recipeId)
        .order("brew_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: variants } = useQuery({
    queryKey: recipeVariantKeys.byRecipe(recipeId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("recipe_variants")
        .select("id, name")
        .eq("recipe_id", recipeId);
      if (error) throw error;
      return data;
    },
  });

  if (batchesLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (!batches || batches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <BarChart3 className="h-10 w-10 text-muted-foreground/50 mb-3" />
        <p className="text-muted-foreground">
          No batches have been brewed from this recipe yet.
        </p>
      </div>
    );
  }

  // Build variant lookup map
  const variantMap = new Map<string, string>();
  if (variants) {
    for (const v of variants) {
      variantMap.set(v.id, v.name);
    }
  }

  // Performance summary calculations
  const totalBatches = batches.length;
  const batchesWithOg = batches.filter(
    (b) => b.actual_og != null
  );
  const avgOg =
    batchesWithOg.length > 0
      ? batchesWithOg.reduce((sum, b) => sum + Number(b.actual_og), 0) /
        batchesWithOg.length
      : null;
  const ogVariance =
    avgOg != null && estOg != null ? avgOg - estOg : null;

  return (
    <div className="space-y-4">
      {/* Performance Summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <div className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" />
            Total Batches
          </div>
          <div className="text-lg font-semibold">{totalBatches}</div>
        </div>
        {avgOg != null && (
          <div>
            <div className="text-sm font-medium text-muted-foreground">
              Avg Actual OG
            </div>
            <div className="text-lg font-semibold">{avgOg.toFixed(1)}°P</div>
          </div>
        )}
        {ogVariance != null && (
          <div>
            <div className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" />
              OG Variance
            </div>
            <div
              className={`text-lg font-semibold ${
                ogVariance > 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : ogVariance < 0
                    ? "text-red-600 dark:text-red-400"
                    : ""
              }`}
            >
              {ogVariance > 0 ? "+" : ""}
              {ogVariance.toFixed(1)}°P
            </div>
          </div>
        )}
      </div>

      {/* Batches Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Brew Date</TableHead>
            <TableHead>Batch #</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Variant</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actual OG</TableHead>
            <TableHead>Volume (BBL)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.map((batch) => (
            <TableRow key={batch.id}>
              <TableCell>
                {batch.brew_date
                  ? new Date(batch.brew_date).toLocaleDateString()
                  : "—"}
              </TableCell>
              <TableCell>
                <Link
                  href={`/production/batches/${batch.id}`}
                  className="font-medium hover:underline"
                >
                  {batch.batch_number}
                </Link>
              </TableCell>
              <TableCell>{batch.name || "—"}</TableCell>
              <TableCell>
                {batch.recipe_variant_id &&
                variantMap.has(batch.recipe_variant_id)
                  ? variantMap.get(batch.recipe_variant_id)
                  : "—"}
              </TableCell>
              <TableCell>
                <StatusBadge
                  status={batch.status}
                  config={batchEntity.stateMachine?.stateDisplay}
                />
              </TableCell>
              <TableCell>
                {batch.actual_og != null
                  ? `${Number(batch.actual_og).toFixed(1)}°P`
                  : "—"}
              </TableCell>
              <TableCell>
                {batch.volume_bbl != null ? batch.volume_bbl : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
