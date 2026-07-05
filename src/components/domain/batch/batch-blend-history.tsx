"use client";

/**
 * BatchBlendHistory - Shows blend sources for a batch
 *
 * Displays a table of source batches that were blended into this batch,
 * including volume contributions and totals.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { entityKeys, batchKeys } from "@/lib/query-keys";
import { dynamicFrom } from "@/services/types";
import { unwrap } from "@/lib/supabase/query-helpers";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, GitMerge } from "lucide-react";
import Link from "next/link";
import { getStateLabel } from "@/types/entity";
import { batchEntity } from "@/entities/batch";
import { UnitDisplay } from "@/components/ui/unit-input";
import { useGravityUnit } from "@/hooks/use-unit-preferences";
import { formatGravityFromSg } from "@/domain/units";

// =============================================================================
// Types
// =============================================================================

type BatchBlendHistoryProps = {
  data: { id: string; [key: string]: unknown };
}

/** Row shape returned by the batch_blend_details view. */
type BlendDetailRow = {
  id: string;
  blend_batch_id: string;
  blend_batch_code: string | null;
  blend_batch_name: string | null;
  source_batch_id: string;
  source_batch_code: string | null;
  source_batch_name: string | null;
  source_batch_status: string | null;
  source_recipe_name: string | null;
  volume_bbl: number;
  blended_at: string;
}

/** Row shape returned by the batches_with_blend_info view. */
type BlendInfoRow = {
  id: string;
  blended_og: number | null;
  blended_fg: number | null;
  blended_abv: number | null;
  blended_ibu: number | null;
  blended_srm: number | null;
  blend_source_recipes: string[] | null;
  volume_blended_away_bbl: number | null;
  available_volume_bbl: number | null;
}

// =============================================================================
// Component
// =============================================================================

export function BatchBlendHistory({ data }: BatchBlendHistoryProps) {
  const supabase = createClient();
  const batchId = data.id;
  const gravityUnit = useGravityUnit();

  const { data: blends, isLoading } = useQuery({
    queryKey: entityKeys.related("batch_blends", "blend_batch_id", batchId),
    queryFn: async () => {
      return (await unwrap(
        dynamicFrom(supabase, "batch_blend_details")
          .select("*")
          .eq("blend_batch_id", batchId)
          .order("blended_at", { ascending: false })
      )) as unknown as BlendDetailRow[] | null;
    },
  });

  // Also check if this batch was used as a source in other blends
  const { data: usedInBlends } = useQuery({
    queryKey: entityKeys.related("batch_blends", "source_batch_id", batchId),
    queryFn: async () => {
      return (await unwrap(
        dynamicFrom(supabase, "batch_blend_details")
          .select("*")
          .eq("source_batch_id", batchId)
          .order("blended_at", { ascending: false })
      )) as unknown as BlendDetailRow[] | null;
    },
  });

  // Fetch blend info (weighted estimates, available volume)
  const { data: blendInfo } = useQuery({
    queryKey: batchKeys.blendInfo(batchId),
    queryFn: async () => {
      return (await unwrap(
        dynamicFrom(supabase, "batches_with_blend_info")
          .select("*")
          .eq("id", batchId)
          .single()
      )) as unknown as BlendInfoRow | null;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading blend history...
      </div>
    );
  }

  const hasBlendSources = blends && blends.length > 0;
  const isUsedAsSource = usedInBlends && usedInBlends.length > 0;

  if (!hasBlendSources && !isUsedAsSource) {
    return (
      <div className="text-center py-4 text-muted-foreground text-sm">
        No blend history for this batch.
      </div>
    );
  }

  const totalVolume = blends?.reduce((sum: number, b: BlendDetailRow) => sum + Number(b.volume_bbl), 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* Blend sources (batches blended INTO this batch) */}
      {hasBlendSources && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <GitMerge className="h-4 w-4" />
            Blended From
          </div>
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source Batch</TableHead>
                  <TableHead>Recipe</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Volume</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {blends?.map((blend: BlendDetailRow) => (
                  <TableRow key={blend.id}>
                    <TableCell>
                      <Link
                        href={`/production/batches/${blend.source_batch_id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {blend.source_batch_code}
                      </Link>
                      {blend.source_batch_name && (
                        <span className="text-muted-foreground ml-2 text-sm">
                          {blend.source_batch_name}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {blend.source_recipe_name ?? "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {getStateLabel(batchEntity, blend.source_batch_status)}
                      </Badge>
                    </TableCell>
                    <TableCell><UnitDisplay value={Number(blend.volume_bbl)} unitType="volume" /></TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(blend.blended_at).toLocaleDateString("en-US")}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/30 font-medium">
                  <TableCell colSpan={3} className="text-right">
                    Total Blended Volume:
                  </TableCell>
                  <TableCell><UnitDisplay value={totalVolume} unitType="volume" /></TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Blended estimates summary */}
      {hasBlendSources && blendInfo && (
        <div className="rounded-md border bg-muted/30 p-4 space-y-2">
          <h4 className="font-medium text-sm">Blended Estimates</h4>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-4 text-sm">
            {blendInfo.blended_og != null && (
              <div>
                <span className="text-muted-foreground">OG:</span>{" "}
                <span className="font-medium">{formatGravityFromSg(Number(blendInfo.blended_og), gravityUnit)}</span>
              </div>
            )}
            {blendInfo.blended_fg != null && (
              <div>
                <span className="text-muted-foreground">FG:</span>{" "}
                <span className="font-medium">{formatGravityFromSg(Number(blendInfo.blended_fg), gravityUnit)}</span>
              </div>
            )}
            {blendInfo.blended_abv != null && (
              <div>
                <span className="text-muted-foreground">ABV:</span>{" "}
                <span className="font-medium">{Number(blendInfo.blended_abv).toFixed(1)}%</span>
              </div>
            )}
            {blendInfo.blended_ibu != null && (
              <div>
                <span className="text-muted-foreground">IBU:</span>{" "}
                <span className="font-medium">{Number(blendInfo.blended_ibu)}</span>
              </div>
            )}
            {blendInfo.blended_srm != null && (
              <div>
                <span className="text-muted-foreground">SRM:</span>{" "}
                <span className="font-medium">{Number(blendInfo.blended_srm).toFixed(1)}</span>
              </div>
            )}
          </div>
          {(blendInfo.blend_source_recipes?.length ?? 0) > 0 && (
            <div className="text-sm">
              <span className="text-muted-foreground">Source Recipes:</span>{" "}
              <span className="font-medium">{blendInfo.blend_source_recipes?.join(", ")}</span>
            </div>
          )}
        </div>
      )}

      {/* Used as source (this batch was blended INTO other batches) */}
      {isUsedAsSource && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <GitMerge className="h-4 w-4 rotate-180" />
            Used as Source In
          </div>
          {blendInfo && Number(blendInfo.volume_blended_away_bbl) > 0 && (
            <p className="text-sm text-muted-foreground">
              <UnitDisplay value={Number(blendInfo.volume_blended_away_bbl)} unitType="volume" /> blended away
              {" "}(<UnitDisplay value={Number(blendInfo.available_volume_bbl)} unitType="volume" /> remaining)
            </p>
          )}
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Blend Batch</TableHead>
                  <TableHead>Volume</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usedInBlends?.map((blend: BlendDetailRow) => (
                  <TableRow key={blend.id}>
                    <TableCell>
                      <Link
                        href={`/production/batches/${blend.blend_batch_id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {blend.blend_batch_code}
                      </Link>
                      {blend.blend_batch_name && (
                        <span className="text-muted-foreground ml-2 text-sm">
                          {blend.blend_batch_name}
                        </span>
                      )}
                    </TableCell>
                    <TableCell><UnitDisplay value={Number(blend.volume_bbl)} unitType="volume" /></TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(blend.blended_at).toLocaleDateString("en-US")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
