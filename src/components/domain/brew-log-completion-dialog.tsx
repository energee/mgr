"use client";

/**
 * BrewLogCompletionDialog - 3-step wizard for completing a brew log
 *
 * Step 1: Review Measurements - shows key measurements from brew day events
 * Step 2: Assign Vessels - vessel assignment for each linked batch
 * Step 3: Confirm & Complete - review summary before finalizing
 *
 * After completion, navigates to the first batch detail page.
 */

import React, { useState, useMemo, useCallback, useEffect } from "react";
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
import {
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { UnitDisplay } from "@/components/ui/unit-input";
import { extractBrewMeasurements } from "@/lib/brew-events";

// =============================================================================
// Types
// =============================================================================

interface BrewLogCompletionDialogProps {
  brewLogId: string;
  brewNumber: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (firstBatchId?: string) => void;
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

function formatVesselCapacity(
  capacityBbl: number | null,
  targetVolume: number,
): React.ReactNode {
  if (capacityBbl && targetVolume) {
    return ` (${Math.round((targetVolume / capacityBbl) * 100)}% full)`;
  }
  if (capacityBbl) {
    return <> (<UnitDisplay value={capacityBbl} unitType="volume" />)</>;
  }
  return null;
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

  const [step, setStep] = useState(1);
  const [vesselAssignments, setVesselAssignments] = useState<
    Record<string, string>
  >({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset step when dialog opens
  useEffect(() => {
    if (open) {
      setStep(1);
      setVesselAssignments({});
    }
  }, [open]);

  // ---------------------------------------------------------------------------
  // Data Fetching
  // ---------------------------------------------------------------------------

  // Fetch brew log with events for step 1
  const { data: brewLogFull } = useQuery({
    queryKey: brewLogKeys.detail(brewLogId),
    queryFn: async () => {
      const { data, error } = await db
        .from("brew_logs")
        .select("id, brew_number, status, events")
        .eq("id", brewLogId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

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
  // Sort by best capacity fit for the target batch
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

      const filtered = availableVessels.filter(
        (v) => !excludedIds.includes(v.id)
      );

      // Sort by best capacity fit
      const batch = linkedBatches.find((b) => b.id === batchId);
      const targetVolume = batch?.link_volume_bbl ?? batch?.volume_bbl ?? 0;

      return filtered.sort((a, b) => {
        const aFit = (a.capacity_bbl ?? Infinity) - targetVolume;
        const bFit = (b.capacity_bbl ?? Infinity) - targetVolume;
        // Prefer vessels that can hold the batch (positive fit)
        if (aFit >= 0 && bFit < 0) return -1;
        if (aFit < 0 && bFit >= 0) return 1;
        // Among same-sign fits, prefer closest to target
        return Math.abs(aFit) - Math.abs(bFit);
      });
    },
    [availableVessels, vesselAssignments, linkedBatches]
  );

  // ---------------------------------------------------------------------------
  // Step titles and progress
  // ---------------------------------------------------------------------------

  const stepTitles = [
    "Review Measurements",
    "Assign Vessels",
    "Confirm & Complete",
  ];

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
      onSuccess(linkedBatches[0]?.id);
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
  // Render Steps
  // ---------------------------------------------------------------------------

  const renderStep1 = () => {
    const events = (brewLogFull?.events as unknown[]) || [];
    const keyMeasurements = extractBrewMeasurements(events);

    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Review the key measurements from your brew day before completing.
        </p>
        {keyMeasurements.length === 0 ? (
          <div className="py-6 text-center text-muted-foreground text-sm">
            No key measurements recorded. You can proceed to vessel assignment.
          </div>
        ) : (
          <div className="grid gap-3">
            {keyMeasurements.map((m) => (
              <div
                key={m.label}
                className="flex items-center justify-between p-3 rounded-md border"
              >
                <span className="text-sm font-medium">{m.label}</span>
                <span className="text-sm">{m.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderStep2 = () => {
    if (linkedBatches.length === 0) {
      return (
        <div className="py-8 text-center text-muted-foreground">
          No batches are linked to this brew log. Link batches before
          completing.
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {linkedBatches.map((batch) => {
          const hasVessel = !!batch.current_vessel_id;
          const assignedVesselId = vesselAssignments[batch.id];
          const batchVessels = getAvailableVesselsForBatch(batch.id);
          const targetVolume =
            batch.link_volume_bbl ?? batch.volume_bbl ?? 0;

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
                    <UnitDisplay
                      value={batch.link_volume_bbl ?? batch.volume_bbl}
                      unitType="volume"
                    />
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
                        setVesselAssignments((prev) => {
                          const next = { ...prev };
                          if (val === "_none") {
                            delete next[batch.id];
                          } else {
                            next[batch.id] = val;
                          }
                          return next;
                        })
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
                            {formatVesselCapacity(v.capacity_bbl, targetVolume)}
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
    );
  };

  const renderStep3 = () => (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Review and confirm the following actions:
      </p>
      <div className="p-4 rounded-md border space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Brew Log</span>
          <span className="font-medium">
            {brewNumber} &rarr; Completed
          </span>
        </div>
        {linkedBatches.map((batch) => {
          const vesselId =
            vesselAssignments[batch.id] || batch.current_vessel_id;
          const vessel = vesselId
            ? availableVessels.find((v) => v.id === vesselId)
            : null;
          const vesselName =
            vessel?.name || batch.current_vessel_name || "\u2014";
          return (
            <div key={batch.id} className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {batch.batch_number}
              </span>
              <span className="font-medium">
                &rarr; Fermenting in {vesselName}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );

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
            Step {step} of 3: {stepTitles[step - 1]}
          </DialogDescription>
        </DialogHeader>

        {/* Step progress bar */}
        <div className="flex items-center gap-1 px-1">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                s <= step ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>

        {/* Step content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {step === 1 && renderStep1()}
            {step === 2 && renderStep2()}
            {step === 3 && renderStep3()}
          </>
        )}

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <div>
            {step > 1 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep((s) => s - 1)}
                disabled={isSubmitting}
                className="min-h-[44px]"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
            {step < 3 ? (
              <Button
                type="button"
                onClick={() => setStep((s) => s + 1)}
                disabled={
                  step === 2 &&
                  (!allBatchesHaveVessels || linkedBatches.length === 0)
                }
                className="min-h-[44px]"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
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
                    Complete Brew Day
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
