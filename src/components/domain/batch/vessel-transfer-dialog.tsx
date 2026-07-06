"use client";

/**
 * VesselTransferDialog - Transfer a batch to a different vessel
 *
 * Creates a vessel_transfer record. Does NOT directly update batch status.
 * Instead, suggests a state transition based on the destination vessel type
 * via the `onSuggestTransition` callback, allowing the caller to handle
 * state changes through proper state machine transitions.
 *
 * Features:
 * - Auto-fills volume from the batch's current volume
 * - Duplicate detection: pre-checks for recent transfers to the same
 *   destination vessel within a 5-minute window (UX convenience;
 *   the DB unique index provides the actual constraint)
 * - Smart state suggestions based on destination vessel type:
 *   - planned batch -> fermenter/unitank => suggest "fermenting"
 *   - fermenting batch -> brite tank => suggest "conditioning"
 * - Implied loss capture: when the transferred volume is less than the
 *   batch's remaining volume, prompts a RecordLossDialog to record the
 *   difference as a loss allocation (feeds TTB losses)
 */

import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/form-resolver";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { unwrap } from "@/lib/supabase/query-helpers";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormActions } from "@/components/ui/form-actions";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import { batchKeys, vesselKeys, entityKeys } from "@/lib/query-keys";
import { UnitDisplay, UnitInput } from "@/components/ui/unit-input";
import { log } from "@/lib/client-logger";
import { getValueLabel } from "@/types/entity";
import { vesselEntity } from "@/entities/vessel";
import { isDuplicateTransfer, groupVesselsForTransfer } from "./vessel-transfer-utils";
import { computeTransferLoss } from "@/domain/consumption-planning";
import { RecordLossDialog } from "@/components/domain/shared/record-loss-dialog";

const vesselTransferSchema = z.object({
  to_vessel_id: z.string().uuid("Please select a destination vessel"),
  volume_bbl: z.coerce.number().positive("Volume must be positive"),
  notes: z.string().optional(),
});

type VesselTransferFormValues = z.infer<typeof vesselTransferSchema>;

type VesselTransferDialogProps = {
  batchId: string;
  batchNumber: string;
  /** Current batch status, used to determine smart state suggestions. */
  batchStatus?: string;
  fromVesselId: string | null;
  fromVesselName: string | null;
  currentVolume?: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  /**
   * Called after a successful transfer when a state transition is suggested
   * based on the destination vessel type. The caller is responsible for
   * presenting the suggestion and executing the transition if confirmed.
   */
  onSuggestTransition?: (toState: string, vesselName: string) => void;
}

/**
 * Derives a suggested batch state based on the current batch status
 * and the destination vessel type after a transfer.
 */
function getSuggestedState(
  batchStatus: string,
  vesselType: string,
): string | undefined {
  if (
    batchStatus === "planned" &&
    (vesselType === "fermenter" || vesselType === "unitank")
  ) {
    return "fermenting";
  }
  if (batchStatus === "fermenting" && vesselType === "brite") {
    return "conditioning";
  }
  return undefined;
}

export function VesselTransferDialog({
  batchId,
  batchNumber,
  batchStatus,
  fromVesselId,
  fromVesselName,
  currentVolume,
  open,
  onOpenChange,
  onSuccess,
  onSuggestTransition,
}: VesselTransferDialogProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  // Implied loss prompt (9.3): volume left behind when transferring less
  // than the batch's remaining volume. Rendered after the transfer succeeds.
  const [impliedLossBbl, setImpliedLossBbl] = useState<number | null>(null);

  // Fetch available vessels (ready_for_use, no current batch, exclude source)
  const { data: vessels, isLoading: vesselsLoading } = useQuery({
    queryKey: vesselKeys.available(),
    queryFn: async () => {
      return await unwrap(
        supabase
          .from("vessels")
          .select("id, name, vessel_type, capacity_bbl")
          .eq("status", "ready_for_use")
          .eq("is_active", true)
          .is("current_batch_id", null)
          .order("name")
      );
    },
    enabled: open,
  });

  // Calculate volume already transferred OUT of the current source vessel.
  // Only counts transfers from this specific vessel to avoid double-counting
  // on multi-hop batches (e.g., Kettle→FV→BT each move the same volume).
  const { data: transferredVolume } = useQuery({
    queryKey: batchKeys.remainingVolume(batchId, fromVesselId),
    queryFn: async () => {
      let query = supabase
        .from("vessel_transfers")
        .select("volume_bbl")
        .eq("batch_id", batchId);

      if (fromVesselId) {
        query = query.eq("from_vessel_id", fromVesselId);
      } else {
        query = query.is("from_vessel_id", null);
      }

      const data = await unwrap(query);
      const total = (data ?? []).reduce((sum, t) => sum + Number(t.volume_bbl), 0);
      return total;
    },
    enabled: open,
  });

  const remainingVolume = currentVolume
    ? Math.max(0, currentVolume - (transferredVolume ?? 0))
    : 0;

  // Filter out the source vessel
  const availableVessels = vessels?.filter((v) => v.id !== fromVesselId);

  // Form
  const form = useForm<VesselTransferFormValues>({
    resolver: zodResolver(vesselTransferSchema),
    defaultValues: {
      to_vessel_id: "",
      volume_bbl: 0,
      notes: "",
    },
  });

  // Track whether the user has manually edited the volume field.
  // Prevents the auto-fill from overwriting user input on query refetch.
  const volumeTouchedRef = useRef(false);

  // Reset touched flag when dialog closes, so next open gets auto-fill
  useEffect(() => {
    if (!open) {
      volumeTouchedRef.current = false;
    }
  }, [open]);

  // Auto-fill volume from remaining volume, but skip if user has edited
  useEffect(() => {
    if (open && remainingVolume > 0 && !volumeTouchedRef.current) {
      form.setValue("volume_bbl", remainingVolume);
    }
  }, [remainingVolume, open, form]);

  // Transfer mutation
  const transferMutation = useMutation({
    mutationFn: async (values: VesselTransferFormValues) => {
      // Pre-check: UX convenience to catch accidental double-submits.
      // Note: the DB unique index (idx_vessel_transfers_unique_per_batch)
      // provides the actual constraint; this check avoids a less-friendly
      // constraint violation error in the common case.
      let preCheckQuery = supabase
        .from("vessel_transfers")
        .select("id, transferred_at")
        .eq("batch_id", batchId)
        .eq("to_vessel_id", values.to_vessel_id);

      // Match the DB unique index which includes from_vessel_id
      if (fromVesselId) {
        preCheckQuery = preCheckQuery.eq("from_vessel_id", fromVesselId);
      } else {
        preCheckQuery = preCheckQuery.is("from_vessel_id", null);
      }

      const { data: existing } = await preCheckQuery
        .order("transferred_at", { ascending: false })
        .limit(1);

      if (existing && existing.length > 0) {
        const lastTransferredAt = existing[0].transferred_at;
        if (isDuplicateTransfer(lastTransferredAt)) {
          const minutesAgo = Math.floor(
            (Date.now() - new Date(lastTransferredAt).getTime()) / 60000
          );
          throw new Error(
            `This batch was already transferred to this vessel ${minutesAgo} minute(s) ago. Wait a moment or choose a different vessel.`
          );
        }
      }

      // Create the vessel transfer record
      const { error: transferError } = await supabase
        .from("vessel_transfers")
        .insert({
          batch_id: batchId,
          from_vessel_id: fromVesselId,
          to_vessel_id: values.to_vessel_id,
          volume_bbl: values.volume_bbl,
          transferred_at: new Date().toISOString(),
          notes: values.notes || null,
        });

      if (transferError) {
        // Friendly message for unique constraint violations
        if (transferError.code === "23505") {
          throw new Error("A transfer with these exact details already exists.");
        }
        throw transferError;
      }

      // Vessel occupancy (current_batch_id, status) is updated automatically
      // by the handle_vessel_transfer() database trigger on vessel_transfers INSERT.

      // Return destination vessel info for smart state suggestion in onSuccess
      const destVessel = availableVessels?.find((v) => v.id === values.to_vessel_id);
      return { vesselName: destVessel?.name, vesselType: destVessel?.vessel_type };
    },
    onSuccess: ({ vesselName, vesselType }, values) => {
      queryClient.invalidateQueries({ queryKey: batchKeys.all() });
      // The batches LIST is keyed on the view, not ["batches"] — without this
      // the row's vessel column stays stale after a transfer from the list.
      queryClient.invalidateQueries({ queryKey: entityKeys.all("batches_with_brew_info") });
      queryClient.invalidateQueries({ queryKey: vesselKeys.all() });
      queryClient.invalidateQueries({ queryKey: vesselKeys.transfers() });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("vessel_transfers") });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("vessel_transfers_with_details") });
      toast.success(`Transfer recorded: ${batchNumber} to ${vesselName || "vessel"}`);
      onOpenChange(false);
      form.reset();

      // Suggest a state transition based on destination vessel type
      if (batchStatus && onSuggestTransition && vesselType) {
        const suggestedState = getSuggestedState(batchStatus, vesselType);
        if (suggestedState) {
          onSuggestTransition(suggestedState, vesselName || "vessel");
        }
      }

      // Implied loss: volume left behind in the source vessel (9.3).
      // Prompts a RecordLossDialog after this dialog closes.
      const loss = computeTransferLoss(remainingVolume, values.volume_bbl);
      if (loss > 0) {
        setImpliedLossBbl(loss);
      }

      onSuccess?.();
    },
    onError: (error) => {
      log.error("Vessel transfer error:", error);
      toast.error(error.message);
    },
  });

  const handleSubmit = form.handleSubmit((values) => {
    transferMutation.mutate(values);
  });

  const selectedVesselId = form.watch("to_vessel_id");
  const selectedVessel = availableVessels?.find((v) => v.id === selectedVesselId);
  const watchedVolume = form.watch("volume_bbl");
  const exceedsCapacity = !!(selectedVessel && watchedVolume > selectedVessel.capacity_bbl);

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRight className="h-5 w-5" />
            Transfer Vessel
          </DialogTitle>
          <DialogDescription>
            Transfer batch {batchNumber} from{" "}
            {fromVesselName || "kettle"} to another vessel.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {fromVesselName && (
            <div className="space-y-2">
              <Label>From Vessel</Label>
              <p className="text-sm text-muted-foreground">{fromVesselName}</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="to_vessel_id">Destination Vessel</Label>
            <Select
              value={selectedVesselId}
              onValueChange={(v) => form.setValue("to_vessel_id", v)}
              disabled={vesselsLoading}
            >
              <SelectTrigger className="min-h-[44px]">
                <SelectValue placeholder={vesselsLoading ? "Loading..." : "Select vessel..."} />
              </SelectTrigger>
              <SelectContent>
                {availableVessels?.length === 0 ? (
                  <div className="p-2 text-sm text-muted-foreground text-center">
                    No vessels available
                  </div>
                ) : (
                  // Grouped by vessel type with the batch's expected next
                  // stage first (fermenting → brites), so the right tank is
                  // at the top instead of buried in an any-tank list.
                  groupVesselsForTransfer(availableVessels ?? [], batchStatus).map((group) => (
                    <SelectGroup key={group.vesselType}>
                      <SelectLabel>
                        {getValueLabel(vesselEntity, "vessel_type", group.vesselType)}
                        {group.preferred ? " · suggested" : ""}
                      </SelectLabel>
                      {group.vessels.map((vessel) => (
                        <SelectItem key={vessel.id} value={vessel.id}>
                          <span className="font-medium">{vessel.name}</span>
                          <span className="text-muted-foreground ml-2">
                            (<UnitDisplay value={vessel.capacity_bbl} unitType="volume" />)
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))
                )}
              </SelectContent>
            </Select>
            {form.formState.errors.to_vessel_id && (
              <p className="text-sm text-destructive">
                {form.formState.errors.to_vessel_id.message}
              </p>
            )}
            {selectedVessel && (
              <p className="text-sm text-muted-foreground">
                Capacity: <UnitDisplay value={selectedVessel.capacity_bbl} unitType="volume" />
                {watchedVolume > 0 && selectedVessel.capacity_bbl > 0 && !exceedsCapacity && (
                  <> &middot; fills {Math.round((watchedVolume / selectedVessel.capacity_bbl) * 100)}%</>
                )}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="volume_bbl">Volume</Label>
            <UnitInput
              value={watchedVolume || null}
              onChange={(val) => {
                volumeTouchedRef.current = true;
                form.setValue("volume_bbl", val ?? 0, { shouldValidate: true });
              }}
              unitType="volume"
              decimals={2}
              placeholder="e.g., 7"
              className="min-h-[44px]"
            />
            {form.formState.errors.volume_bbl && (
              <p className="text-sm text-destructive">
                {form.formState.errors.volume_bbl.message}
              </p>
            )}
            {exceedsCapacity && (
              <p className="text-sm text-destructive">
                Volume exceeds vessel capacity (<UnitDisplay value={selectedVessel.capacity_bbl} unitType="volume" />)
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              {...form.register("notes")}
              placeholder="Transfer notes..."
              rows={2}
            />
          </div>

          <DialogFooter>
            <FormActions
              submitLabel="Transfer"
              loadingLabel="Transferring..."
              submitIcon={<ArrowRight className="h-4 w-4 mr-2" />}
              isLoading={transferMutation.isPending}
              submitDisabled={!availableVessels?.length || exceedsCapacity}
              onCancel={() => onOpenChange(false)}
            />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    {impliedLossBbl !== null && (
      <RecordLossDialog
        batchId={batchId}
        batchNumber={batchNumber}
        suggestedVolumeBbl={impliedLossBbl}
        context="Volume left behind at vessel transfer"
        open={impliedLossBbl !== null}
        onOpenChange={(o) => {
          if (!o) setImpliedLossBbl(null);
        }}
      />
    )}
    </>
  );
}
