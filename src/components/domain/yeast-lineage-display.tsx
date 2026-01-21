"use client";

/**
 * Yeast Lineage Display
 *
 * Shows the family tree of yeast pitches from original purchase
 * through all harvests. Displays cost spreading and generation info.
 */

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/universal/status-badge";
import { cn } from "@/lib/utils";
import { shouldReplaceYeast } from "@/lib/yeast-calculations";
import { yeastPitchEntity } from "@/entities/yeast-pitch";

interface YeastLineageDisplayProps {
  pitchId: string;
}

interface PitchNode {
  id: string;
  strain_id: string;
  strain_name?: string;
  source_type: "purchase" | "harvest";
  generation: number;
  status: string;
  cost: number | null;
  batch_name?: string | null;
  harvest_date?: string | null;
  received_date?: string | null;
  estimated_viability?: number;
  viability_status?: string;
}

export function YeastLineageDisplay({ pitchId }: YeastLineageDisplayProps) {
  // Find the root of the lineage (the original purchase)
  const { data: root, isLoading: rootLoading } = useQuery({
    queryKey: ["yeast-lineage-root", pitchId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supabase = createClient() as any;

      // Get the current pitch
      const { data: currentPitch } = await supabase
        .from("yeast_pitches_with_details")
        .select("*")
        .eq("id", pitchId)
        .single();

      if (!currentPitch) return null;

      // If this is a purchase, it's the root
      if (currentPitch.source_type === "purchase") {
        return currentPitch;
      }

      // Walk up the tree to find the root
      let current = currentPitch;
      while (current.parent_pitch_id) {
        const { data: parent } = await supabase
          .from("yeast_pitches_with_details")
          .select("*")
          .eq("id", current.parent_pitch_id)
          .single();

        if (!parent) break;
        current = parent;
      }

      return current;
    },
  });

  // Get all pitches in the lineage
  const { data: lineage, isLoading: lineageLoading } = useQuery({
    queryKey: ["yeast-lineage", root?.id],
    queryFn: async () => {
      if (!root?.id) return [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supabase = createClient() as any;

      // Get all descendants including root
      const result: PitchNode[] = [];

      async function getDescendants(parentId: string | null, depth: number = 0) {
        const query = parentId
          ? supabase
              .from("yeast_pitches_with_details")
              .select("*")
              .eq("parent_pitch_id", parentId)
          : supabase
              .from("yeast_pitches_with_details")
              .select("*")
              .eq("id", root!.id);

        const { data: pitches } = await query;

        if (pitches) {
          for (const pitch of pitches) {
            result.push(pitch as PitchNode);
            await getDescendants(pitch.id, depth + 1);
          }
        }
      }

      await getDescendants(null);
      return result;
    },
    enabled: !!root?.id,
  });

  // Get lineage summary for cost info
  const { data: summary } = useQuery({
    queryKey: ["yeast-lineage-summary", root?.id],
    queryFn: async () => {
      if (!root?.id) return null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supabase = createClient() as any;
      const { data } = await supabase
        .from("yeast_lineage_summary")
        .select("*")
        .eq("root_id", root.id)
        .single();

      return data;
    },
    enabled: !!root?.id,
  });

  const isLoading = rootLoading || lineageLoading;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Lineage</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-20 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!lineage || lineage.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Lineage</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No lineage information available.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Sort by generation
  const sortedLineage = [...lineage].sort((a, b) => a.generation - b.generation);
  const currentPitchInLineage = sortedLineage.find((p) => p.id === pitchId);
  const replacementCheck = currentPitchInLineage
    ? shouldReplaceYeast(currentPitchInLineage.generation)
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Lineage</span>
          {summary && (
            <Badge variant="outline" className="text-xs font-normal">
              {summary.total_pitches_in_lineage} pitches, {summary.batches_used}{" "}
              batches
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Cost Summary */}
        {summary && summary.original_cost && (
          <div className="rounded-md bg-muted p-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Original Cost</p>
                <p className="font-medium">
                  ${Number(summary.original_cost).toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Cost Per Batch</p>
                <p className="font-medium">
                  ${Number(summary.cost_per_batch).toFixed(2)}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Replacement Warning */}
        {replacementCheck?.reason && (
          <div
            className={cn(
              "rounded-md p-3 text-sm",
              replacementCheck.replace
                ? "bg-destructive/10 text-destructive"
                : "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
            )}
          >
            {replacementCheck.reason}
          </div>
        )}

        {/* Lineage Tree */}
        <div className="space-y-1">
          {sortedLineage.map((pitch) => {
            const isCurrent = pitch.id === pitchId;
            const isRoot = pitch.source_type === "purchase";
            const indent = pitch.generation - 1;

            return (
              <div
                key={pitch.id}
                className={cn(
                  "flex items-center gap-2 rounded-md p-2 text-sm",
                  isCurrent && "bg-primary/10 ring-1 ring-primary"
                )}
                style={{ paddingLeft: `${indent * 20 + 8}px` }}
              >
                {/* Tree connector */}
                {!isRoot && (
                  <span className="text-muted-foreground">└</span>
                )}

                {/* Generation badge */}
                <Badge
                  variant={isCurrent ? "default" : "outline"}
                  className="min-w-[40px] justify-center"
                >
                  G{pitch.generation}
                </Badge>

                {/* Pitch info */}
                <Link
                  href={`/production/yeast-pitches/${pitch.id}`}
                  className={cn(
                    "hover:underline",
                    isCurrent && "font-medium"
                  )}
                >
                  {pitch.strain_name || "Unknown Strain"}
                </Link>

                {/* Status */}
                <StatusBadge
                  status={pitch.status}
                  config={yeastPitchEntity.stateMachine?.stateDisplay}
                />

                {/* Batch if in use */}
                {pitch.batch_name && (
                  <span className="text-xs text-muted-foreground">
                    → {pitch.batch_name}
                  </span>
                )}

                {/* Viability */}
                {pitch.estimated_viability !== null &&
                  pitch.estimated_viability !== undefined && (
                    <span
                      className={cn(
                        "ml-auto text-xs",
                        pitch.viability_status === "excellent"
                          ? "text-green-600"
                          : pitch.viability_status === "good"
                            ? "text-green-500"
                            : pitch.viability_status === "marginal"
                              ? "text-yellow-500"
                              : pitch.viability_status === "low"
                                ? "text-orange-500"
                                : "text-red-500"
                      )}
                    >
                      {Math.round(pitch.estimated_viability)}%
                    </span>
                  )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
