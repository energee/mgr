"use client";

/**
 * BatchBlendDialog - Add source batches to a blend
 *
 * Allows brewers to combine multiple batches into a single blended batch.
 * Shows available batches (fermenting or conditioning), lets the user
 * select source batches with volumes, and calculates blend totals.
 */

import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { batchKeys, entityKeys } from "@/lib/query-keys";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, GitMerge } from "lucide-react";
import { toast } from "sonner";
import { getStateLabel } from "@/types/entity";
import { batchEntity } from "@/entities/batch";

// =============================================================================
// Types
// =============================================================================

interface SourceBatch {
  id: string;
  batch_number: string;
  name: string;
  status: string;
  volume_bbl: number | null;
  actual_abv: number | null;
  actual_og: number | null;
  actual_fg: number | null;
  recipe_id: string | null;
}

interface SourceBatchSelection {
  batchId: string;
  volumeBbl: number;
  notes: string;
}

interface BatchBlendDialogProps {
  batchId: string;
  batchNumber: string;
  batchName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function BatchBlendDialog({
  batchId,
  batchNumber,
  batchName,
  open,
  onOpenChange,
  onSuccess,
}: BatchBlendDialogProps) {
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const queryClient = useQueryClient();
  const [selections, setSelections] = useState<Map<string, SourceBatchSelection>>(new Map());
  const [globalNotes, setGlobalNotes] = useState("");

  // Fetch available source batches (fermenting or conditioning, excluding current batch)
  const { data: availableBatches, isLoading: batchesLoading } = useQuery({
    queryKey: batchKeys.list({ status: ["fermenting", "conditioning"], forBlend: true }),
    queryFn: async () => {
      const { data, error } = await db
        .from("batches_with_brew_info")
        .select("id, batch_number, name, status, volume_bbl, actual_abv, actual_og, actual_fg, recipe_id")
        .in("status", ["fermenting", "conditioning"])
        .neq("id", batchId)
        .order("batch_number");
      if (error) throw error;
      return data as SourceBatch[];
    },
    enabled: open,
  });

  // Fetch existing blends for this batch
  const { data: existingBlends } = useQuery({
    queryKey: batchKeys.blends(batchId),
    queryFn: async () => {
      const { data, error } = await db
        .from("batch_blends")
        .select("source_batch_id")
        .eq("blend_batch_id", batchId);
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Fetch blend info for available volume calculation
  const { data: blendInfoData } = useQuery({
    queryKey: batchKeys.list({ blendInfo: true }),
    queryFn: async () => {
      const { data, error } = await db
        .from("batches_with_blend_info")
        .select("id, available_volume_bbl, volume_blended_away_bbl");
      if (error) throw error;
      return data as { id: string; available_volume_bbl: number; volume_blended_away_bbl: number }[];
    },
    enabled: open,
  });

  // Map batch ID to available volume
  const availableVolumeMap = useMemo(
    () => new Map(blendInfoData?.map((info) => [info.id, Number(info.available_volume_bbl)]) ?? []),
    [blendInfoData]
  );

  const existingSourceIds = useMemo(
    () => new Set(existingBlends?.map((b: { source_batch_id: string }) => b.source_batch_id) ?? []),
    [existingBlends]
  );

  // Filter out batches already blended into this one
  const filteredBatches = useMemo(
    () => availableBatches?.filter((b) => !existingSourceIds.has(b.id)) ?? [],
    [availableBatches, existingSourceIds]
  );

  // Toggle batch selection
  const toggleBatch = (batch: typeof filteredBatches[number]) => {
    setSelections((prev) => {
      const next = new Map(prev);
      if (next.has(batch.id)) {
        next.delete(batch.id);
      } else {
        next.set(batch.id, {
          batchId: batch.id,
          volumeBbl: availableVolumeMap.get(batch.id) ?? batch.volume_bbl ?? 0,
          notes: "",
        });
      }
      return next;
    });
  };

  // Update volume for a selected batch
  const updateVolume = (sourceBatchId: string, volume: number) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const existing = next.get(sourceBatchId);
      if (existing) {
        next.set(sourceBatchId, { ...existing, volumeBbl: volume });
      }
      return next;
    });
  };

  // Calculate blend totals
  const blendTotals = useMemo(() => {
    const selectedEntries = Array.from(selections.values());
    if (selectedEntries.length === 0) return null;

    const totalVolume = selectedEntries.reduce((sum, s) => sum + s.volumeBbl, 0);

    const weightedAvg = (getValue: (batch: (typeof filteredBatches)[number]) => number | null | undefined) => {
      let weightedSum = 0;
      let volumeSum = 0;
      for (const sel of selectedEntries) {
        const batch = filteredBatches.find((b) => b.id === sel.batchId);
        const val = batch ? getValue(batch) : null;
        if (val != null && sel.volumeBbl > 0) {
          weightedSum += val * sel.volumeBbl;
          volumeSum += sel.volumeBbl;
        }
      }
      return volumeSum > 0 ? weightedSum / volumeSum : null;
    };

    return {
      totalVolume,
      weightedAbv: weightedAvg((b) => b.actual_abv),
      weightedOg: weightedAvg((b) => b.actual_og),
      weightedFg: weightedAvg((b) => b.actual_fg),
      batchCount: selectedEntries.length,
    };
  }, [selections, filteredBatches]);

  // Submit mutation
  const blendMutation = useMutation({
    mutationFn: async () => {
      const entries = Array.from(selections.values());
      if (entries.length === 0) throw new Error("Select at least one source batch");

      // Validate volumes don't exceed available volume
      for (const entry of entries) {
        const sourceBatch = filteredBatches.find((b) => b.id === entry.batchId);
        const maxVol = availableVolumeMap.get(entry.batchId) ?? sourceBatch?.volume_bbl;
        if (maxVol != null && entry.volumeBbl > maxVol) {
          throw new Error(
            `Volume for ${sourceBatch?.batch_number} (${entry.volumeBbl} BBL) exceeds available volume (${maxVol.toFixed(2)} BBL)`
          );
        }
        if (entry.volumeBbl <= 0) {
          throw new Error(`Volume must be greater than 0 for all selected batches`);
        }
      }

      // Insert all blend records
      const records = entries.map((entry) => ({
        blend_batch_id: batchId,
        source_batch_id: entry.batchId,
        volume_bbl: entry.volumeBbl,
        notes: globalNotes || null,
      }));

      const { error } = await db.from("batch_blends").insert(records);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: batchKeys.all() });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("batch_blends") });
      queryClient.invalidateQueries({ queryKey: batchKeys.list({ blendInfo: true }) });
      toast.success(
        `Added ${selections.size} source batch${selections.size > 1 ? "es" : ""} to blend for ${batchNumber}`
      );
      handleClose();
      onSuccess?.();
    },
    onError: (error) => {
      console.error("Blend error:", error);
      const message = error instanceof Error ? error.message : "Failed to create blend";
      toast.error(message);
    },
  });

  const handleClose = () => {
    setSelections(new Map());
    setGlobalNotes("");
    onOpenChange(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    blendMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-5 w-5" />
            Blend Batches
          </DialogTitle>
          <DialogDescription>
            Select source batches to blend into {batchNumber} ({batchName}).
            Only batches in fermenting or conditioning status are shown.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Batch selection table */}
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Available (BBL)</TableHead>
                  <TableHead>ABV %</TableHead>
                  <TableHead>Blend Volume (BBL)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batchesLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                      Loading batches...
                    </TableCell>
                  </TableRow>
                ) : filteredBatches.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No eligible batches available for blending.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredBatches.map((batch) => {
                    const isSelected = selections.has(batch.id);
                    const selection = selections.get(batch.id);
                    return (
                      <TableRow
                        key={batch.id}
                        className={isSelected ? "bg-muted/50" : "cursor-pointer hover:bg-muted/30"}
                        onClick={() => toggleBatch(batch)}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleBatch(batch)}
                          />
                        </TableCell>
                        <TableCell>
                          <div>
                            <span className="font-medium">{batch.batch_number}</span>
                            <span className="text-muted-foreground ml-2 text-sm">{batch.name}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {getStateLabel(batchEntity, batch.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {(availableVolumeMap.get(batch.id) ?? batch.volume_bbl)?.toFixed(2) ?? "-"}
                        </TableCell>
                        <TableCell>{batch.actual_abv ?? "-"}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {isSelected ? (
                            <Input
                              type="number"
                              step="0.01"
                              min="0.01"
                              max={availableVolumeMap.get(batch.id) ?? batch.volume_bbl ?? undefined}
                              value={selection?.volumeBbl ?? ""}
                              onChange={(e) =>
                                updateVolume(batch.id, parseFloat(e.target.value) || 0)
                              }
                              className="w-24 min-h-[36px]"
                            />
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Blend summary */}
          {blendTotals && (
            <div className="rounded-md border bg-muted/30 p-4 space-y-2">
              <h4 className="font-medium text-sm">Blend Summary</h4>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Source Batches:</span>{" "}
                  <span className="font-medium">{blendTotals.batchCount}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Total Volume:</span>{" "}
                  <span className="font-medium">{blendTotals.totalVolume.toFixed(2)} BBL</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Weighted ABV:</span>{" "}
                  <span className="font-medium">
                    {blendTotals.weightedAbv != null ? `${blendTotals.weightedAbv.toFixed(1)}%` : "N/A"}
                  </span>
                </div>
                {blendTotals.weightedOg != null && (
                  <div>
                    <span className="text-muted-foreground">Weighted OG:</span>{" "}
                    <span className="font-medium">{blendTotals.weightedOg.toFixed(3)}</span>
                  </div>
                )}
                {blendTotals.weightedFg != null && (
                  <div>
                    <span className="text-muted-foreground">Weighted FG:</span>{" "}
                    <span className="font-medium">{blendTotals.weightedFg.toFixed(3)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="blend-notes">Notes</Label>
            <Textarea
              id="blend-notes"
              value={globalNotes}
              onChange={(e) => setGlobalNotes(e.target.value)}
              placeholder="Optional notes about this blend..."
              className="min-h-[60px]"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              className="min-h-[44px]"
              disabled={blendMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={blendMutation.isPending || selections.size === 0}
              className="min-h-[44px]"
            >
              {blendMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Blending...
                </>
              ) : (
                <>
                  <GitMerge className="h-4 w-4 mr-2" />
                  Add to Blend ({selections.size})
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
