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
import { dynamicRpc } from "@/services/types";
import { yeastKeys } from "@/lib/query-keys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/universal/status-badge";
import { cn } from "@/lib/utils";
import { shouldReplaceYeast } from "@/lib/yeast-calculations";
import { yeastPitchEntity, VIABILITY_STATUS_DISPLAY } from "@/entities/yeast-pitch";

type YeastLineageDisplayProps = {
  pitchId: string;
}

type PitchNode = {
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
  // Find the root of the lineage. Tries the server-side RPC first; falls back to
  // a client-side parent walk if the function isn't available (e.g. stale schema cache).
  const { data: rootId, isLoading: rootLoading } = useQuery({
    queryKey: yeastKeys.lineageRoot(pitchId),
    queryFn: async () => {
      const supabase = createClient();

      // Try RPC first (single recursive CTE, no N+1)
      const { data: rpcResult, error: rpcError } = await dynamicRpc(
        supabase,
        "get_yeast_lineage_root",
        { p_pitch_id: pitchId }
      );
      if (!rpcError && rpcResult) return rpcResult as string;

      // Fallback: walk up parent chain via the view
      let currentId = pitchId;
      for (;;) {
        const { data: pitch } = await supabase
          .from("yeast_pitches_with_remaining")
          .select("id, parent_pitch_id, source_type")
          .eq("id", currentId)
          .single();

        if (!pitch || !pitch.parent_pitch_id || pitch.source_type === "purchase") {
          return pitch?.id ?? pitchId;
        }
        currentId = pitch.parent_pitch_id;
      }
    },
  });

  // Fetch all descendants of the root and build the lineage tree
  const { data: lineage, isLoading: lineageLoading } = useQuery({
    queryKey: yeastKeys.lineage(rootId),
    queryFn: async () => {
      if (!rootId) return [];

      const supabase = createClient();

      // Fetch the root pitch first
      const { data: rootPitch } = await supabase
        .from("yeast_pitches_with_remaining")
        .select("id, strain_id, strain_name, source_type, generation, status, cost, harvest_date, received_date, estimated_viability, viability_status, parent_pitch_id")
        .eq("id", rootId)
        .single();

      if (!rootPitch?.strain_id) return [];

      // Fetch all pitches that share the same strain — DFS below filters to only
      // those reachable from root, so unrelated lineages for the same strain are excluded.
      const { data: allPitches } = await supabase
        .from("yeast_pitches_with_remaining")
        .select("id, strain_id, strain_name, source_type, generation, status, cost, harvest_date, received_date, estimated_viability, viability_status, parent_pitch_id")
        .eq("strain_id", rootPitch.strain_id);

      if (!allPitches || allPitches.length === 0) return [];

      // Build a children map: parent_id -> children[]
      const childrenMap = new Map<string | null, PitchNode[]>();
      for (const pitch of allPitches as (PitchNode & { parent_pitch_id?: string | null })[]) {
        const parentId = pitch.parent_pitch_id ?? null;
        if (!childrenMap.has(parentId)) {
          childrenMap.set(parentId, []);
        }
        childrenMap.get(parentId)!.push(pitch);
      }

      // DFS traversal from root to collect only descendants of this lineage
      const result: PitchNode[] = [];
      function dfs(nodeId: string) {
        const node = (allPitches as (PitchNode & { parent_pitch_id?: string | null })[]).find(
          (p) => p.id === nodeId
        );
        if (!node) return;
        result.push(node);
        const children = childrenMap.get(nodeId) || [];
        for (const child of children) {
          dfs(child.id);
        }
      }

      dfs(rootId);
      return result;
    },
    enabled: !!rootId,
  });

  // Get lineage summary for cost info
  const { data: summary } = useQuery({
    queryKey: yeastKeys.lineageSummary(rootId),
    queryFn: async () => {
      if (!rootId) return null;

      const supabase = createClient();
      const { data } = await supabase
        .from("yeast_lineage_summary")
        .select("*")
        .eq("root_id", rootId)
        .single();

      return data;
    },
    enabled: !!rootId,
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

                {/* Viability — uses shared VIABILITY_STATUS_DISPLAY config (DEC-007) */}
                {pitch.estimated_viability != null && (
                    <span className="ml-auto">
                      <StatusBadge
                        status={`${Math.round(pitch.estimated_viability)}%`}
                        variant={VIABILITY_STATUS_DISPLAY[pitch.viability_status || "good"]?.color || "default"}
                      />
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
