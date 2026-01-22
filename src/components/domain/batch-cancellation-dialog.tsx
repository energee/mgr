"use client";

/**
 * BatchCancellationDialog - Cancel a batch with proper cleanup
 *
 * When a batch needs to be cancelled, this dialog:
 * 1. Captures the cancellation reason
 * 2. Records the loss volume (optional)
 * 3. Adds notes for audit trail
 * 4. Calls the cancel_batch RPC which:
 *    - Updates batch status
 *    - Releases vessel assignment
 *    - Creates loss allocation record
 *    - Cancels pending allocations
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Loader2, XCircle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

// =============================================================================
// Types
// =============================================================================

const cancellationReasons = [
  { value: "quality", label: "Quality Issue", description: "Beer did not meet quality standards" },
  { value: "contamination", label: "Contamination", description: "Microbial or foreign contamination detected" },
  { value: "equipment", label: "Equipment Failure", description: "Equipment malfunction during process" },
  { value: "scheduling", label: "Scheduling Change", description: "Production schedule changed" },
  { value: "other", label: "Other", description: "Other reason (specify in notes)" },
] as const;

const cancellationSchema = z.object({
  reason: z.enum(["quality", "contamination", "equipment", "scheduling", "other"], {
    required_error: "Please select a reason",
  }),
  loss_volume_bbl: z.coerce.number().min(0, "Volume cannot be negative").nullable().optional(),
  notes: z.string().max(1000, "Notes must be less than 1000 characters").nullable().optional(),
});

type CancellationFormValues = z.infer<typeof cancellationSchema>;

interface BatchCancellationDialogProps {
  batchId: string;
  batchNumber: string;
  batchName: string;
  currentStatus: string;
  currentVolume?: number | null;
  vesselName?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function BatchCancellationDialog({
  batchId,
  batchNumber,
  batchName,
  currentStatus,
  currentVolume,
  vesselName,
  open,
  onOpenChange,
  onSuccess,
}: BatchCancellationDialogProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [showConfirm, setShowConfirm] = useState(false);

  // Form
  const form = useForm<CancellationFormValues>({
    resolver: zodResolver(cancellationSchema),
    defaultValues: {
      reason: undefined,
      loss_volume_bbl: currentVolume || null,
      notes: "",
    },
  });

  // Reset form when dialog opens
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      form.reset({
        reason: undefined,
        loss_volume_bbl: currentVolume || null,
        notes: "",
      });
      setShowConfirm(false);
    }
    onOpenChange(isOpen);
  };

  // Cancel batch mutation
  const cancelMutation = useMutation({
    mutationFn: async (values: CancellationFormValues) => {
      // Note: Type assertion needed until supabase types are regenerated
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)("cancel_batch", {
        p_batch_id: batchId,
        p_reason: values.reason,
        p_loss_volume_bbl: values.loss_volume_bbl || null,
        p_notes: values.notes || null,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      queryClient.invalidateQueries({ queryKey: ["vessels"] });
      queryClient.invalidateQueries({ queryKey: ["vessel_transfers"] });
      queryClient.invalidateQueries({ queryKey: ["allocations"] });

      const vesselReleased = data?.vessel_released;
      toast.success(
        `Batch ${batchNumber} cancelled${vesselReleased ? `. ${vesselReleased} released.` : ""}`
      );
      handleOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      console.error("Cancel batch error:", error);
      const message = error instanceof Error ? error.message : "Failed to cancel batch";
      toast.error(message);
    },
  });

  const handleSubmit = form.handleSubmit((values) => {
    if (!showConfirm) {
      setShowConfirm(true);
      return;
    }
    cancelMutation.mutate(values);
  });

  const selectedReason = form.watch("reason");
  const selectedReasonInfo = cancellationReasons.find((r) => r.value === selectedReason);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <XCircle className="h-5 w-5" />
            Cancel Batch
          </DialogTitle>
          <DialogDescription>
            Cancel batch {batchNumber} ({batchName}). This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Warning alert */}
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Warning</AlertTitle>
            <AlertDescription className="text-sm">
              <ul className="list-disc list-inside space-y-1 mt-1">
                <li>Batch status will change to &ldquo;Cancelled&rdquo;</li>
                {vesselName && <li>{vesselName} will be released and marked dirty</li>}
                <li>Any pending allocations will be cancelled</li>
                <li>Loss will be recorded for TTB compliance</li>
              </ul>
            </AlertDescription>
          </Alert>

          {/* Reason selection */}
          <div className="space-y-2">
            <Label htmlFor="reason">Cancellation Reason *</Label>
            <Select
              value={form.watch("reason")}
              onValueChange={(v) => form.setValue("reason", v as CancellationFormValues["reason"])}
            >
              <SelectTrigger className="min-h-[44px]">
                <SelectValue placeholder="Select reason..." />
              </SelectTrigger>
              <SelectContent>
                {cancellationReasons.map((reason) => (
                  <SelectItem key={reason.value} value={reason.value}>
                    <span className="font-medium">{reason.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.reason && (
              <p className="text-sm text-destructive">
                {form.formState.errors.reason.message}
              </p>
            )}
            {selectedReasonInfo && (
              <p className="text-sm text-muted-foreground">
                {selectedReasonInfo.description}
              </p>
            )}
          </div>

          {/* Loss volume */}
          <div className="space-y-2">
            <Label htmlFor="loss_volume_bbl">Loss Volume (BBL)</Label>
            <Input
              id="loss_volume_bbl"
              type="number"
              step="0.1"
              min="0"
              {...form.register("loss_volume_bbl")}
              placeholder="e.g., 7"
              className="min-h-[44px]"
            />
            {form.formState.errors.loss_volume_bbl && (
              <p className="text-sm text-destructive">
                {form.formState.errors.loss_volume_bbl.message}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Volume of beer lost. Used for TTB loss reporting.
              {currentVolume && ` Current batch volume: ${currentVolume} BBL`}
            </p>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              {...form.register("notes")}
              placeholder="Additional details about the cancellation..."
              className="min-h-[80px]"
            />
            {form.formState.errors.notes && (
              <p className="text-sm text-destructive">
                {form.formState.errors.notes.message}
              </p>
            )}
          </div>

          {/* Confirmation step */}
          {showConfirm && (
            <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-amber-800 dark:text-amber-200">
                Confirm Cancellation
              </AlertTitle>
              <AlertDescription className="text-amber-700 dark:text-amber-300">
                Are you sure you want to cancel this batch? Click &ldquo;Cancel Batch&rdquo; again to confirm.
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="min-h-[44px]"
              disabled={cancelMutation.isPending}
            >
              {showConfirm ? "Go Back" : "Cancel"}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={cancelMutation.isPending || !selectedReason}
              className="min-h-[44px]"
            >
              {cancelMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Cancelling...
                </>
              ) : showConfirm ? (
                <>
                  <XCircle className="h-4 w-4 mr-2" />
                  Confirm Cancellation
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 mr-2" />
                  Cancel Batch
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
