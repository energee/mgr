"use client";

/**
 * VesselTransferDialog - Transfer a batch to a different vessel
 *
 * Used from batch detail when the "Move to Conditioning" action is triggered.
 * Creates a vessel_transfer record and updates batch status to conditioning.
 */

import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/form-resolver";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { batchKeys, vesselKeys, entityKeys } from "@/lib/query-keys";
import { UnitDisplay } from "@/components/ui/unit-input";

// =============================================================================
// Types
// =============================================================================

const vesselTransferSchema = z.object({
  to_vessel_id: z.string().uuid("Please select a destination vessel"),
  volume_bbl: z.coerce.number().positive("Volume must be positive"),
  notes: z.string().optional(),
});

type VesselTransferFormValues = z.infer<typeof vesselTransferSchema>;

interface VesselTransferDialogProps {
  batchId: string;
  batchNumber: string;
  fromVesselId: string | null;
  fromVesselName: string | null;
  currentVolume?: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function VesselTransferDialog({
  batchId,
  batchNumber,
  fromVesselId,
  fromVesselName,
  currentVolume,
  open,
  onOpenChange,
  onSuccess,
}: VesselTransferDialogProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  // Fetch available vessels (ready_for_use, no current batch, exclude source)
  const { data: vessels, isLoading: vesselsLoading } = useQuery({
    queryKey: vesselKeys.available(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vessels")
        .select("id, name, vessel_type, capacity_bbl")
        .eq("status", "ready_for_use")
        .eq("is_active", true)
        .is("current_batch_id", null)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Filter out the source vessel
  const availableVessels = vessels?.filter((v) => v.id !== fromVesselId);

  // Form
  const form = useForm<VesselTransferFormValues>({
    resolver: zodResolver(vesselTransferSchema),
    defaultValues: {
      to_vessel_id: "",
      volume_bbl: currentVolume || 0,
      notes: "",
    },
  });

  // Transfer mutation
  const transferMutation = useMutation({
    mutationFn: async (values: VesselTransferFormValues) => {
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

      if (transferError) throw transferError;

      // Update batch status to conditioning
      const { error: statusError } = await supabase
        .from("batches")
        .update({ status: "conditioning" })
        .eq("id", batchId);

      if (statusError) throw statusError;

      return availableVessels?.find((v) => v.id === values.to_vessel_id)?.name;
    },
    onSuccess: (vesselName) => {
      queryClient.invalidateQueries({ queryKey: batchKeys.all() });
      queryClient.invalidateQueries({ queryKey: vesselKeys.all() });
      queryClient.invalidateQueries({ queryKey: vesselKeys.transfers() });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("vessel_transfers") });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("vessel_transfers_with_details") });
      toast.success(`Batch ${batchNumber} transferred to ${vesselName}`);
      onOpenChange(false);
      form.reset();
      onSuccess?.();
    },
    onError: (error) => {
      console.error("Vessel transfer error:", error);
      const message = error instanceof Error ? error.message : "Failed to transfer batch";
      toast.error(message);
    },
  });

  const handleSubmit = form.handleSubmit((values) => {
    transferMutation.mutate(values);
  });

  // eslint-disable-next-line react-hooks/incompatible-library -- React Hook Form watch() incompatible with React Compiler
  const selectedVesselId = form.watch("to_vessel_id");
  const selectedVessel = availableVessels?.find((v) => v.id === selectedVesselId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRight className="h-5 w-5" />
            Move to Conditioning
          </DialogTitle>
          <DialogDescription>
            Transfer batch {batchNumber} from{" "}
            {fromVesselName || "kettle"} to a conditioning vessel.
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
              value={form.watch("to_vessel_id")}
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
                  availableVessels?.map((vessel) => (
                    <SelectItem key={vessel.id} value={vessel.id}>
                      <span className="font-medium">{vessel.name}</span>
                      <span className="text-muted-foreground ml-2">
                        ({vessel.vessel_type} &middot; <UnitDisplay value={vessel.capacity_bbl} unitType="volume" />)
                      </span>
                    </SelectItem>
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
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="volume_bbl">Volume (BBL)</Label>
            <Input
              id="volume_bbl"
              type="number"
              step="0.1"
              {...form.register("volume_bbl")}
              placeholder="e.g., 7"
              className="min-h-[44px]"
            />
            {form.formState.errors.volume_bbl && (
              <p className="text-sm text-destructive">
                {form.formState.errors.volume_bbl.message}
              </p>
            )}
            {selectedVessel && form.watch("volume_bbl") > selectedVessel.capacity_bbl && (
              <p className="text-sm text-amber-600">
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
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={transferMutation.isPending || !availableVessels?.length}
              className="min-h-[44px]"
            >
              {transferMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Transferring...
                </>
              ) : (
                <>
                  <ArrowRight className="h-4 w-4 mr-2" />
                  Transfer
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
