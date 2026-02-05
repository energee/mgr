"use client";

/**
 * BrewLogCompletionDialog - Complete a brew log and start fermentation
 *
 * When a brew log is completed, this dialog:
 * 1. Shows all linked batches with their current vessel assignments
 * 2. Requires vessel assignment for any batch without one
 * 3. Creates vessel_transfer records for newly assigned vessels
 * 4. Transitions each batch to "fermenting" status
 * 5. Marks the brew log as "completed"
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  brewLogKeys,
  entityKeys,
  batchKeys,
  vesselKeys,
} from "@/lib/query-keys";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { UnitDisplay } from "@/components/ui/unit-input";

// =============================================================================
// Types
// =============================================================================

interface BrewLogCompletionDialogProps {
  brewLogId: string;
  brewNumber: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface LinkedBatch {
  id: string;
  batch_number: string;
  name: string;
  status: string;
  volume_bbl: number | null;
  current_vessel_id: string | null;
  current_vessel_name: string | null;
  link_volume_bbl: number | null;
}

interface AvailableVessel {
  id: string;
  name: string;
  vessel_type: string | null;
  capacity_bbl: number | null;
}

// =============================================================================
// Component
// =============================================================================

export function BrewLogCompletionDialog({
  brewLogId,
  brewNumber,
  open,
  onOpenChange,
  onSuccess,
}: BrewLogCompletionDialogProps) {
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const queryClient = useQueryClient();

  const [vesselAssignments, setVesselAssignments] = useState<
    Record<string, string>
  >({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ---------------------------------------------------------------------------
  // Data Fetching
  // ---------------------------------------------------------------------------

  // Fetch linked batches with current vessel info
  const { data: linkedBatches = [], isLoading: batchesLoading } = useQuery<
    LinkedBatch[]
  >({
    queryKey: brewLogKeys.batchesForCompletion(brewLogId),
    queryFn: async () => {
      // Get brew_log_batches joined with batch info
      const { data: links, error } = await db
        .from("brew_log_batches")
        .select(
          `
          id,
          volume_bbl,
          batch_id
        `
        )
        .eq("brew_log_id", brewLogId);

      if (error) throw error;
      if (!links || links.length === 0) return [];

      // Fetch batch details from the view that includes vessel info
      const batchIds = links.map(
        (l: { batch_id: string }) => l.batch_id
      );

      const { data: batches, error: batchError } = await db
        .from("batches_with_brew_info")
        .select(
          "id, batch_number, name, status, volume_bbl, current_vessel_id, current_vessel_name"
        )
        .in("id", batchIds);

      if (batchError) throw batchError;

      // Combine link and batch data
      return links.map((link: { batch_id: string; volume_bbl: number | null }) => {
        const batch = (batches || []).find(
          (b: { id: string }) => b.id === link.batch_id
        );
        return {
          id: batch?.id ?? link.batch_id,
          batch_number: batch?.batch_number ?? "Unknown",
          name: batch?.name ?? "Unknown",
          status: batch?.status ?? "planned",
          volume_bbl: batch?.volume_bbl ?? null,
          current_vessel_id: batch?.current_vessel_id ?? null,
          current_vessel_name: batch?.current_vessel_name ?? null,
          link_volume_bbl: link.volume_bbl,
        } as LinkedBatch;
      });
    },
    enabled: open,
  });

  // Fetch available vessels (no current batch, active, fermenter or unitank)
  const { data: availableVessels = [], isLoading: vesselsLoading } = useQuery<
    AvailableVessel[]
  >({
    queryKey: vesselKeys.availableForCompletion(),
    queryFn: async () => {
      const { data, error } = await db
        .from("vessels")
        .select("id, name, vessel_type, capacity_bbl")
        .eq("is_active", true)
        .is("current_batch_id", null)
        .in("vessel_type", ["fermenter", "unitank"])
        .order("name");
      if (error) throw error;
      return (data ?? []) as AvailableVessel[];
    },
    enabled: open,
  });

  // ---------------------------------------------------------------------------
  // Computed
  // ---------------------------------------------------------------------------

  // Batches that need vessel assignment (no current vessel and no assignment in state)
  const batchesNeedingVessel = useMemo(
    () =>
      linkedBatches.filter(
        (b) => !b.current_vessel_id && !vesselAssignments[b.id]
      ),
    [linkedBatches, vesselAssignments]
  );

  const allBatchesHaveVessels = batchesNeedingVessel.length === 0;

  // Filter out vessels already assigned to other batches in this dialog
  const getAvailableVesselsForBatch = useCallback(
    (batchId: string) => {
      const assignedVesselIds = Object.entries(vesselAssignments)
        .filter(([id]) => id !== batchId)
        .map(([, vesselId]) => vesselId);

      // Also exclude vessels that are pre-assigned to other batches
      const preAssignedVesselIds = linkedBatches
        .filter((b) => b.id !== batchId && b.current_vessel_id)
        .map((b) => b.current_vessel_id!);

      const excludedIds = [...assignedVesselIds, ...preAssignedVesselIds];

      return availableVessels.filter((v) => !excludedIds.includes(v.id));
    },
    [availableVessels, vesselAssignments, linkedBatches]
  );

  // ---------------------------------------------------------------------------
  // Submission
  // ---------------------------------------------------------------------------

  const handleSubmit = async () => {
    if (!allBatchesHaveVessels || linkedBatches.length === 0) return;
    setIsSubmitting(true);

    try {
      // For each batch: assign vessel (if needed) + transition to fermenting
      for (const batch of linkedBatches) {
        const needsVesselAssignment = !batch.current_vessel_id;
        const assignedVesselId = vesselAssignments[batch.id];

        if (needsVesselAssignment && assignedVesselId) {
          // Find vessel name for the fermenter field
          const vessel = availableVessels.find(
            (v) => v.id === assignedVesselId
          );
          const vesselName = vessel?.name ?? "Unknown";
          const volume = batch.link_volume_bbl ?? batch.volume_bbl ?? 0;

          // Use the atomic RPC function that creates transfer + updates batch
          const { error } = await db.rpc("start_batch_fermentation", {
            p_batch_id: batch.id,
            p_vessel_id: assignedVesselId,
            p_volume_bbl: volume,
            p_vessel_name: vesselName,
          });

          if (error) throw error;
        } else if (batch.current_vessel_id) {
          // Vessel already assigned; just update batch status to fermenting
          const { error } = await db
            .from("batches")
            .update({ status: "fermenting" })
            .eq("id", batch.id);

          if (error) throw error;
        }
      }

      // Mark brew log as completed
      const { error: brewLogError } = await db
        .from("brew_logs")
        .update({ status: "completed" })
        .eq("id", brewLogId);

      if (brewLogError) throw brewLogError;

      // Invalidate caches
      queryClient.invalidateQueries({ queryKey: brewLogKeys.all() });
      queryClient.invalidateQueries({ queryKey: brewLogKeys.detail(brewLogId) });
      queryClient.invalidateQueries({
        queryKey: entityKeys.all("brew_logs"),
      });
      queryClient.invalidateQueries({ queryKey: batchKeys.all() });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("batches") });
      queryClient.invalidateQueries({ queryKey: vesselKeys.all() });
      queryClient.invalidateQueries({ queryKey: vesselKeys.transfers() });

      toast.success(
        `Brew ${brewNumber} completed. ${linkedBatches.length} batch${linkedBatches.length !== 1 ? "es" : ""} moved to fermentation.`
      );

      onOpenChange(false);
      onSuccess();
    } catch (error) {
      console.error("Complete brew error:", error);
      const message =
        error instanceof Error ? error.message : "Failed to complete brew";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isLoading = batchesLoading || vesselsLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5" />
            Complete Brew &amp; Start Fermentation
          </DialogTitle>
          <DialogDescription>
            Complete brew {brewNumber} and transition all linked batches to
            fermentation. Each batch must be assigned to a vessel.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : linkedBatches.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            No batches are linked to this brew log. Link batches before
            completing.
          </div>
        ) : (
          <div className="space-y-3">
            {linkedBatches.map((batch) => {
              const hasVessel = !!batch.current_vessel_id;
              const assignedVesselId = vesselAssignments[batch.id];
              const batchVessels = getAvailableVesselsForBatch(batch.id);

              return (
                <Card key={batch.id}>
                  <CardContent className="pt-4 pb-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium text-sm">
                          {batch.batch_number}
                        </span>
                        {batch.name && batch.name !== batch.batch_number && (
                          <span className="text-muted-foreground text-sm ml-2">
                            {batch.name}
                          </span>
                        )}
                      </div>
                      <Badge variant="outline" className="text-xs">
                        <UnitDisplay value={batch.link_volume_bbl ?? batch.volume_bbl} unitType="volume" />
                      </Badge>
                    </div>

                    {hasVessel ? (
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <span className="text-muted-foreground">Vessel:</span>
                        <span className="font-medium">
                          {batch.current_vessel_name}
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <Label className="text-xs">
                          Assign Vessel{" "}
                          <span className="text-destructive">*</span>
                        </Label>
                        <Select
                          value={assignedVesselId ?? "_none"}
                          onValueChange={(val) =>
                            setVesselAssignments((prev) => ({
                              ...prev,
                              [batch.id]:
                                val === "_none" ? undefined! : val,
                            }))
                          }
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Select vessel..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none">
                              Select vessel...
                            </SelectItem>
                            {batchVessels.map((v) => (
                              <SelectItem key={v.id} value={v.id}>
                                {v.name}
                                {v.capacity_bbl
                                  ? <>{" "}(<UnitDisplay value={v.capacity_bbl} unitType="volume" />)</>
                                  : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {!assignedVesselId && (
                          <p className="text-xs text-muted-foreground">
                            A vessel must be assigned to start fermentation
                          </p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="min-h-[44px]"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={
              isSubmitting ||
              !allBatchesHaveVessels ||
              linkedBatches.length === 0
            }
            className="min-h-[44px]"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Completing...
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Complete Brew &amp; Start Fermentation
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
