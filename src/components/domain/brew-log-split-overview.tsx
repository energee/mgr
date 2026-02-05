"use client";

/**
 * BrewLogSplitOverview - Visual split overview for brew log detail
 *
 * Shows how a single brew's wort was split across batches with:
 * - Recipe reference at top (linked to recipe detail)
 * - Horizontal volume bar showing proportional splits
 * - Per-batch cards with status, volume, and vessel info
 */

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brewLogKeys, recipeKeys } from "@/lib/query-keys";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/universal/status-badge";
import { batchEntity } from "@/entities/batch";
import { Beer, FlaskConical, ExternalLink } from "lucide-react";
import { UnitDisplay } from "@/components/ui/unit-input";

// Segment colors for the volume bar
const SEGMENT_COLORS = [
  "bg-blue-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-purple-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-teal-500",
];

interface BrewLogSplitOverviewProps {
  data: {
    id: string;
    recipe_id?: string | null;
    [key: string]: unknown;
  };
}

interface LinkedBatch {
  id: string;
  volume_bbl: number;
  notes: string | null;
  batch: {
    id: string;
    batch_number: string;
    name: string;
    status: string;
    volume_bbl: number | null;
    current_vessel_name: string | null;
  } | null;
}

interface RecipeSummary {
  id: string;
  name: string;
  batch_size_bbl: number | null;
  est_og: number | null;
  style_name: string | null;
}

export function BrewLogSplitOverview({ data }: BrewLogSplitOverviewProps) {
  const brewLogId = data.id;
  const recipeId = data.recipe_id;
  const supabase = createClient();

  // Fetch linked batches with brew info (includes current_vessel_name)
  const { data: linkedBatches, isLoading: batchesLoading } = useQuery({
    queryKey: brewLogKeys.batches(brewLogId),
    queryFn: async () => {
      const { data: links, error } = await supabase
        .from("brew_log_batches")
        .select(
          `
          id,
          volume_bbl,
          notes,
          batch:batches_with_brew_info!brew_log_batches_batch_id_fkey (
            id,
            batch_number,
            name,
            status,
            volume_bbl,
            current_vessel_name
          )
        `
        )
        .eq("brew_log_id", brewLogId);

      if (error) throw error;
      return (links ?? []) as unknown as LinkedBatch[];
    },
  });

  // Fetch recipe summary if recipe_id exists
  const { data: recipe } = useQuery({
    queryKey: recipeKeys.summary(recipeId!),
    enabled: !!recipeId,
    queryFn: async () => {
      const { data: rec, error } = await supabase
        .from("recipes_with_estimates")
        .select("id, name, batch_size_bbl, est_og, style_name")
        .eq("id", recipeId!)
        .single();

      if (error) throw error;
      return rec as RecipeSummary;
    },
  });

  if (batchesLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-8 w-full rounded-full" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </div>
    );
  }

  // Filter to only valid linked batches
  const validBatches = (linkedBatches ?? []).filter((lb) => lb.batch);

  if (validBatches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <FlaskConical className="mb-3 h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          No batches linked to this brew yet.
        </p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Link batches to track how this brew&apos;s wort was split.
        </p>
      </div>
    );
  }

  const totalVolume = validBatches.reduce(
    (sum, lb) => sum + (Number(lb.volume_bbl) || 0),
    0
  );

  return (
    <div className="space-y-5">
      {/* Recipe reference */}
      {recipe && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
          <Beer className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Link
                href={`/production/recipes/${recipe.id}`}
                className="truncate font-medium hover:underline"
              >
                {recipe.name}
              </Link>
              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
            </div>
            <div className="flex gap-4 text-xs text-muted-foreground">
              {recipe.style_name && <span>{recipe.style_name}</span>}
              {recipe.batch_size_bbl != null && (
                <span><UnitDisplay value={recipe.batch_size_bbl} unitType="volume" /></span>
              )}
              {recipe.est_og != null && (
                <span>Est. OG <UnitDisplay value={recipe.est_og} unitType="gravity" decimals={1} /></span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Volume split bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Volume Split</span>
          <span><UnitDisplay value={totalVolume} unitType="volume" /> total</span>
        </div>
        <div className="flex h-7 w-full overflow-hidden rounded-full bg-muted">
          {validBatches.map((lb, index) => {
            const volume = Number(lb.volume_bbl) || 0;
            const pct = totalVolume > 0 ? (volume / totalVolume) * 100 : 0;
            const color = SEGMENT_COLORS[index % SEGMENT_COLORS.length];

            if (pct <= 0) return null;

            return (
              <div
                key={lb.id}
                className={`${color} relative flex items-center justify-center text-[10px] font-medium text-white transition-all`}
                style={{ width: `${pct}%` }}
                title={`${lb.batch!.name}: ${volume.toFixed(2)} BBL (${pct.toFixed(0)}%)`}
              >
                {pct > 15 && (
                  <span className="truncate px-1">{lb.batch!.name}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-batch cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {validBatches.map((lb, index) => {
          const batch = lb.batch!;
          const volume = Number(lb.volume_bbl) || 0;
          const pct = totalVolume > 0 ? (volume / totalVolume) * 100 : 0;
          const dotColor = SEGMENT_COLORS[index % SEGMENT_COLORS.length];

          return (
            <Card key={lb.id} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dotColor}`}
                      />
                      <Link
                        href={`/production/batches/${batch.id}`}
                        className="truncate font-medium hover:underline"
                      >
                        {batch.batch_number}
                      </Link>
                    </div>
                    <p className="mt-0.5 truncate pl-[18px] text-sm text-muted-foreground">
                      {batch.name}
                    </p>
                  </div>
                  <StatusBadge
                    status={batch.status}
                    config={batchEntity.stateMachine?.stateDisplay}
                  />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 pl-[18px] text-sm">
                  <div>
                    <span className="text-muted-foreground">Volume</span>
                    <p className="font-medium">
                      <UnitDisplay value={volume} unitType="volume" />
                      <Badge
                        variant="outline"
                        className="ml-1.5 text-[10px] font-normal"
                      >
                        {pct.toFixed(0)}%
                      </Badge>
                    </p>
                  </div>
                  {batch.current_vessel_name && (
                    <div>
                      <span className="text-muted-foreground">Vessel</span>
                      <p className="font-medium">{batch.current_vessel_name}</p>
                    </div>
                  )}
                </div>

                {lb.notes && (
                  <p className="mt-2 pl-[18px] text-xs text-muted-foreground">
                    {lb.notes}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
