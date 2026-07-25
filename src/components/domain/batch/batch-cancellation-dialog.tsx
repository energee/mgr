"use client";

/**
 * BatchCancellationDialog - Cancel or Archive a batch
 *
 * Supports two modes based on batch status:
 * - Cancel: For planned batches that never started (no loss)
 * - Archive: For in-progress batches that need to be terminated (with loss)
 *
 * The dialog adapts its UI and calls the appropriate RPC:
 * - cancel_batch: Simple cancellation for planned batches
 * - archive_batch: Full termination with loss recording for in-progress batches
 *
 * Fields use the shared Form primitives (FormField/FormControl/FormMessage)
 * so validation errors are announced and associated with their inputs
 * (audit A11Y-3).
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/form-resolver";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { batchKeys, dashboardKeys, entityKeys, inventoryKeys } from "@/lib/query-keys";
import { dynamicRpc } from "@/services/types";
import { unwrap } from "@/lib/supabase/query-helpers";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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
import { Loader2, XCircle, Archive, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { UnitDisplay, UnitInput } from "@/components/ui/unit-input";
import { log } from "@/lib/client-logger";

// =============================================================================
// Types & Constants
// =============================================================================

type TerminationMode = "cancel" | "archive";

// Reasons for cancelling a planned batch (simpler - no production started)
const cancelReasons = [
  { value: "scheduling", label: "Schedule Change", description: "Production schedule changed" },
  { value: "recipe_change", label: "Recipe Change", description: "Recipe needs modification" },
  { value: "capacity", label: "Capacity Issue", description: "Equipment or capacity constraints" },
  { value: "other", label: "Other", description: "Other reason (specify in notes)" },
] as const;

// Reasons for archiving an in-progress batch (has product, needs loss tracking)
const archiveReasons = [
  { value: "quality", label: "Quality Issue", description: "Beer did not meet quality standards" },
  { value: "contamination", label: "Contamination", description: "Microbial or foreign contamination detected" },
  { value: "equipment", label: "Equipment Failure", description: "Equipment malfunction during process" },
  { value: "scheduling", label: "Scheduling Change", description: "Production schedule changed" },
  { value: "other", label: "Other", description: "Other reason (specify in notes)" },
] as const;

// Combined schema that handles both cancel and archive
// reason validation happens at RPC level based on mode
const terminationSchema = z.object({
  reason: z.string().min(1, "Please select a reason"),
  loss_volume_bbl: z.coerce.number().min(0, "Volume cannot be negative").nullable().optional(),
  notes: z.string().max(1000, "Notes must be less than 1000 characters").nullable().optional(),
});

type TerminationFormValues = z.infer<typeof terminationSchema>;

type BatchCancellationDialogProps = {
  batchId: string;
  batchNumber: string;
  batchName: string | null;
  currentStatus: string | null;
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

  // Determine mode based on status
  const mode: TerminationMode = currentStatus === "planned" ? "cancel" : "archive";
  const isArchive = mode === "archive";
  const reasons = isArchive ? archiveReasons : cancelReasons;

  // Form
  const form = useForm<TerminationFormValues>({
    resolver: zodResolver(terminationSchema),
    defaultValues: {
      reason: "",
      loss_volume_bbl: isArchive ? (currentVolume || null) : null,
      notes: "",
    },
  });

  // Reset form when dialog opens
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      form.reset({
        reason: "",
        loss_volume_bbl: isArchive ? (currentVolume || null) : null,
        notes: "",
      });
      setShowConfirm(false);
    }
    onOpenChange(isOpen);
  };

  // Mutation for both cancel and archive
  const terminateMutation = useMutation({
    mutationFn: async (values: TerminationFormValues) => {
      const rpcName = isArchive ? "archive_batch" : "cancel_batch";
      return await unwrap(
        dynamicRpc(supabase, rpcName, {
          p_batch_id: batchId,
          p_reason: values.reason,
          p_loss_volume_bbl: isArchive ? (values.loss_volume_bbl || null) : null,
          p_notes: values.notes || null,
        })
      );
    },
    onSuccess: (data) => {
      // Invalidate both the base table and view table for batches
      queryClient.invalidateQueries({ queryKey: batchKeys.all() });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("batches_with_brew_info") });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("vessels") });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("vessels_with_current_batch") });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("vessel_transfers") });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.allocations() });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all() });

      const vesselReleased = (data as unknown as { vessel_released?: string } | null)?.vessel_released;
      const action = isArchive ? "archived" : "cancelled";
      toast.success(
        `Batch ${batchNumber} ${action}${vesselReleased ? `. ${vesselReleased} released.` : ""}`
      );
      handleOpenChange(false);
      onSuccess?.();
    },
    onError: (error: unknown) => {
      log.error(`${mode} batch error:`, JSON.stringify(error, null, 2));
      // Supabase errors have message, code, details, hint properties
      const pgError = error as { message?: string; code?: string; details?: string; hint?: string };
      const message = pgError?.message || (error instanceof Error ? error.message : `Failed to ${mode} batch`);
      toast.error(message);
    },
  });

  const handleSubmit = form.handleSubmit((values) => {
    if (!showConfirm) {
      setShowConfirm(true);
      return;
    }
    terminateMutation.mutate(values);
  });

  const selectedReason = form.watch("reason");
  const selectedReasonInfo = reasons.find((r) => r.value === selectedReason);

  const Icon = isArchive ? Archive : XCircle;
  const title = isArchive ? "Archive Batch" : "Cancel Batch";
  const actionLabel = isArchive ? "Archive" : "Cancel";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Icon className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription>
            {isArchive
              ? `Archive batch ${batchNumber} (${batchName}). This will terminate the batch and record any product loss.`
              : `Cancel batch ${batchNumber} (${batchName}). This batch hasn't started yet.`}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Warning alert */}
          <Alert variant={isArchive ? "destructive" : "default"}>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{isArchive ? "Warning" : "Note"}</AlertTitle>
            <AlertDescription className="text-sm">
              <ul className="list-disc list-inside space-y-1 mt-1">
                <li>Batch status will change to &ldquo;{isArchive ? "Archived" : "Cancelled"}&rdquo;</li>
                {isArchive && vesselName && <li>{vesselName} will be released and marked dirty</li>}
                {isArchive && <li>Any pending allocations will be cancelled</li>}
                {isArchive && <li>Loss will be recorded for TTB compliance</li>}
                {!isArchive && <li>Any ingredient reservations will be released</li>}
              </ul>
            </AlertDescription>
          </Alert>

          {/* Reason selection */}
          <FormField
            control={form.control}
            name="reason"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{isArchive ? "Archive" : "Cancellation"} Reason *</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="min-h-[44px]">
                      <SelectValue placeholder="Select reason..." />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {reasons.map((reason) => (
                      <SelectItem key={reason.value} value={reason.value}>
                        <span className="font-medium">{reason.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
                {selectedReasonInfo && (
                  <p className="text-sm text-muted-foreground">
                    {selectedReasonInfo.description}
                  </p>
                )}
              </FormItem>
            )}
          />

          {/* Loss volume - only for archive mode */}
          {isArchive && (
            <FormField
              control={form.control}
              name="loss_volume_bbl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Loss Volume</FormLabel>
                  <FormControl>
                    <UnitInput
                      value={typeof field.value === "number" ? field.value : null}
                      onChange={field.onChange}
                      unitType="volume"
                      decimals={1}
                    />
                  </FormControl>
                  <FormMessage />
                  <FormDescription>
                    Volume of beer lost. Used for TTB loss reporting.
                    {currentVolume && <>{" "}Current batch volume: <UnitDisplay value={currentVolume} unitType="volume" /></>}
                  </FormDescription>
                </FormItem>
              )}
            />
          )}

          {/* Notes */}
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder={`Additional details about the ${mode === "archive" ? "archive" : "cancellation"}...`}
                    className="min-h-[80px]"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Confirmation step */}
          {showConfirm && (
            <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-amber-800 dark:text-amber-200">
                Confirm {actionLabel}
              </AlertTitle>
              <AlertDescription className="text-amber-700 dark:text-amber-300">
                Are you sure you want to {mode} this batch? Click &ldquo;{actionLabel} Batch&rdquo; again to confirm.
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="min-h-[44px]"
              disabled={terminateMutation.isPending}
            >
              {showConfirm ? "Go Back" : "Close"}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={terminateMutation.isPending || !selectedReason}
              className="min-h-[44px]"
            >
              {terminateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {isArchive ? "Archiving..." : "Cancelling..."}
                </>
              ) : showConfirm ? (
                <>
                  <Icon className="h-4 w-4 mr-2" />
                  Confirm {actionLabel}
                </>
              ) : (
                <>
                  <Icon className="h-4 w-4 mr-2" />
                  {actionLabel} Batch
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// Re-export with alias for backwards compatibility
