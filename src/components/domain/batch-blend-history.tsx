"use client";

/**
 * BatchBlendHistory - Shows blend sources for a batch
 *
 * Displays a table of source batches that were blended into this batch,
 * including volume contributions and totals.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { entityKeys } from "@/lib/query-keys";
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

// =============================================================================
// Types
// =============================================================================

interface BatchBlendHistoryProps {
  data: { id: string; [key: string]: unknown };
}

// =============================================================================
// Component
// =============================================================================

export function BatchBlendHistory({ data }: BatchBlendHistoryProps) {
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const batchId = data.id;

  const { data: blends, isLoading } = useQuery({
    queryKey: entityKeys.related("batch_blends", "blend_batch_id", batchId),
    queryFn: async () => {
      const { data, error } = await db
        .from("batch_blend_details")
        .select("*")
        .eq("blend_batch_id", batchId)
        .order("blended_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Also check if this batch was used as a source in other blends
  const { data: usedInBlends } = useQuery({
    queryKey: entityKeys.related("batch_blends", "source_batch_id", batchId),
    queryFn: async () => {
      const { data, error } = await db
        .from("batch_blend_details")
        .select("*")
        .eq("source_batch_id", batchId)
        .order("blended_at", { ascending: false });
      if (error) throw error;
      return data;
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalVolume = blends?.reduce((sum: number, b: any) => sum + Number(b.volume_bbl), 0) ?? 0;

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
                  <TableHead>Volume (BBL)</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {blends?.map((blend: any) => (
                  <TableRow key={blend.id}>
                    <TableCell>
                      <Link
                        href={`/production/batches/${blend.source_batch_id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {blend.source_batch_number}
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
                      <Badge variant="outline" className="capitalize">
                        {blend.source_batch_status}
                      </Badge>
                    </TableCell>
                    <TableCell>{Number(blend.volume_bbl).toFixed(2)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(blend.blended_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/30 font-medium">
                  <TableCell colSpan={3} className="text-right">
                    Total Blended Volume:
                  </TableCell>
                  <TableCell>{totalVolume.toFixed(2)} BBL</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Used as source (this batch was blended INTO other batches) */}
      {isUsedAsSource && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <GitMerge className="h-4 w-4 rotate-180" />
            Used as Source In
          </div>
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Blend Batch</TableHead>
                  <TableHead>Volume (BBL)</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {usedInBlends?.map((blend: any) => (
                  <TableRow key={blend.id}>
                    <TableCell>
                      <Link
                        href={`/production/batches/${blend.blend_batch_id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {blend.blend_batch_number}
                      </Link>
                      {blend.blend_batch_name && (
                        <span className="text-muted-foreground ml-2 text-sm">
                          {blend.blend_batch_name}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{Number(blend.volume_bbl).toFixed(2)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(blend.blended_at).toLocaleDateString()}
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
