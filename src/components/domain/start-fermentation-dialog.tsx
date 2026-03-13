"use client";

/**
 * StartFermentationDialog - Begin fermentation for a batch
 *
 * When a batch is ready to start fermenting, this dialog:
 * 1. Shows available vessels (ready_for_use status)
 * 2. Captures the volume being transferred
 * 3. Creates a vessel_transfer record (knockout from kettle)
 * 4. Updates the batch status to 'fermenting'
 *
 * The vessel_transfer trigger automatically updates vessel status.
 */

import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/form-resolver";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicRpc } from "@/services/types";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { batchKeys, vesselKeys } from "@/lib/query-keys";
import { UnitDisplay, UnitInput } from "@/components/ui/unit-input";
import { log } from "@/lib/client-logger";

const startFermentationSchema = z.object({
  vessel_id: z.string().uuid("Please select a vessel"),
  volume_bbl: z.coerce.number().positive("Volume must be positive"),
});

type StartFermentationFormValues = z.infer<typeof startFermentationSchema>;

type StartFermentationDialogProps = {
  batchId: string;
  batchNumber: string;
  plannedVolume?: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function StartFermentationDialog({
  batchId,
  batchNumber,
  plannedVolume,
  open,
  onOpenChange,
  onSuccess,
}: StartFermentationDialogProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  // Fetch available vessels (ready_for_use status)
  const { data: vessels, isLoading: vesselsLoading } = useQuery({
    queryKey: vesselKeys.available(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vessels")
        .select("id, name, vessel_type, capacity_bbl")
        .eq("status", "ready_for_use")
        .eq("is_active", true)
        .is("current_batch_id", null)
        .in("vessel_type", ["fermenter", "unitank"])
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Form
  const form = useForm<StartFermentationFormValues>({
    resolver: zodResolver(startFermentationSchema),
    defaultValues: {
      vessel_id: "",
      volume_bbl: plannedVolume || 0,
    },
  });

  // Start fermentation mutation
  const startMutation = useMutation({
    mutationFn: async (values: StartFermentationFormValues) => {
      const selectedVessel = vessels?.find((v) => v.id === values.vessel_id);
      if (!selectedVessel) throw new Error("Vessel not found");

      // Use atomic function to ensure both operations succeed or fail together
      const { error } = await dynamicRpc(supabase, "start_batch_fermentation", {
        p_batch_id: batchId,
        p_vessel_id: values.vessel_id,
        p_volume_bbl: values.volume_bbl,
        p_vessel_name: selectedVessel.name,
      });

      if (error) throw error;

      return selectedVessel.name;
    },
    onSuccess: (vesselName) => {
      queryClient.invalidateQueries({ queryKey: batchKeys.all() });
      queryClient.invalidateQueries({ queryKey: vesselKeys.all() });
      queryClient.invalidateQueries({ queryKey: vesselKeys.transfers() });
      toast.success(`Fermentation started in ${vesselName}`);
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      log.error("Start fermentation error:", error);
      toast.error(error.message);
    },
  });

  const handleSubmit = form.handleSubmit((values) => {
    startMutation.mutate(values);
  });

  const selectedVesselId = form.watch("vessel_id");
  const selectedVessel = vessels?.find((v) => v.id === selectedVesselId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            Start Fermentation
          </DialogTitle>
          <DialogDescription>
            Transfer batch {batchNumber} to a fermenter to begin fermentation.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vessel_id">Fermenter</Label>
            <Select
              value={form.watch("vessel_id")}
              onValueChange={(v) => form.setValue("vessel_id", v)}
              disabled={vesselsLoading}
            >
              <SelectTrigger className="min-h-[44px]">
                <SelectValue placeholder={vesselsLoading ? "Loading..." : "Select vessel..."} />
              </SelectTrigger>
              <SelectContent>
                {vessels?.length === 0 ? (
                  <div className="p-2 text-sm text-muted-foreground text-center">
                    No vessels available
                  </div>
                ) : (
                  vessels?.map((vessel) => (
                    <SelectItem key={vessel.id} value={vessel.id}>
                      <span className="font-medium">{vessel.name}</span>
                      <span className="text-muted-foreground ml-2">
                        (<UnitDisplay value={vessel.capacity_bbl} unitType="volume" />)
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {form.formState.errors.vessel_id && (
              <p className="text-sm text-destructive">
                {form.formState.errors.vessel_id.message}
              </p>
            )}
            {selectedVessel && (
              <p className="text-sm text-muted-foreground">
                Capacity: <UnitDisplay value={selectedVessel.capacity_bbl} unitType="volume" />
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="volume_bbl">Volume</Label>
            <UnitInput
              value={form.watch("volume_bbl") || null}
              onChange={(val) => form.setValue("volume_bbl", val ?? 0, { shouldValidate: true })}
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
            {selectedVessel && form.watch("volume_bbl") > selectedVessel.capacity_bbl && (
              <p className="text-sm text-amber-600">
                Volume exceeds vessel capacity (<UnitDisplay value={selectedVessel.capacity_bbl} unitType="volume" />)
              </p>
            )}
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
              disabled={startMutation.isPending || !vessels?.length}
              className="min-h-[44px]"
            >
              {startMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <FlaskConical className="h-4 w-4 mr-2" />
                  Start Fermentation
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
