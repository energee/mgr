"use client";

/**
 * Record Cell Count Dialog
 *
 * Quick dialog for updating yeast pitch viability based on a
 * hemocytometer or cell count measurement. Updates the pitch's
 * initial_viability (resetting the decay baseline) and cell_count_thousand.
 *
 * The measured_date field resets the viability decay baseline by updating
 * received_date (for purchases) or harvest_date (for harvests).
 */

import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/form-resolver";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom } from "@/services/types";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { yeastKeys } from "@/lib/query-keys";
import { log } from "@/lib/client-logger";

// =============================================================================
// Types
// =============================================================================

const cellCountSchema = z.object({
  cell_count_thousand: z.coerce
    .number()
    .min(0, "Cell count must be positive"),
  viability: z.coerce.number().min(0).max(100, "Viability must be 0-100"),
  measured_date: z.string().default(() => new Date().toISOString().split("T")[0]),
});

type CellCountFormValues = z.infer<typeof cellCountSchema>;

type RecordCellCountDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pitchId: string;
  pitchName: string;
  /** Source type determines which date field to update for decay baseline reset */
  sourceType?: "purchase" | "harvest";
  onSuccess?: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function RecordCellCountDialog({
  open,
  onOpenChange,
  pitchId,
  pitchName,
  sourceType,
  onSuccess,
}: RecordCellCountDialogProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const form = useForm<CellCountFormValues>({
    resolver: zodResolver(cellCountSchema),
    defaultValues: {
      cell_count_thousand: undefined,
      viability: 95,
      measured_date: new Date().toISOString().split("T")[0],
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: CellCountFormValues) => {
      // Build the update payload: cell count, viability, and reset the
      // decay baseline date based on source type
      const updatePayload: Record<string, unknown> = {
        cell_count_thousand: values.cell_count_thousand,
        initial_viability: values.viability,
      };

      // Reset the decay baseline date so the view recalculates decay
      // from the measurement date instead of the original received/harvest date
      if (sourceType === "harvest") {
        updatePayload.harvest_date = values.measured_date;
      } else {
        // Default to received_date for purchases and unknown source types
        updatePayload.received_date = values.measured_date;
      }

      await unwrap(
        dynamicFrom(supabase, "yeast_pitches")
          .update(updatePayload)
          .eq("id", pitchId),
      );
      return values;
    },
    onSuccess: (values) => {
      queryClient.invalidateQueries({ queryKey: yeastKeys.detail(pitchId) });
      queryClient.invalidateQueries({ queryKey: yeastKeys.all() });

      toast.success(
        `Cell count recorded \u2014 viability updated to ${Math.round(values.viability)}%`
      );

      onOpenChange(false);
      form.reset();
      onSuccess?.();
    },
    onError: (error) => {
      log.error("Record cell count error:", error);
      const message =
        error instanceof Error ? error.message : "Failed to record cell count";
      toast.error(message);
    },
  });

  const handleSubmit = form.handleSubmit((values) => {
    mutation.mutate(values);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Record Cell Count</DialogTitle>
          <DialogDescription>
            Update viability for <strong>{pitchName}</strong> based on a lab
            measurement.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 1. Cell Count */}
          <div className="space-y-2">
            <Label htmlFor="cell_count_thousand">
              Cell Count (thousand cells)
            </Label>
            <Input
              id="cell_count_thousand"
              type="number"
              min={0}
              step="1"
              placeholder="e.g., 200000"
              {...form.register("cell_count_thousand")}
              className="min-h-[44px]"
            />
            {form.formState.errors.cell_count_thousand && (
              <p className="text-sm text-destructive">
                {form.formState.errors.cell_count_thousand.message}
              </p>
            )}
          </div>

          {/* 2. Viability */}
          <div className="space-y-2">
            <Label htmlFor="viability">Viability (%)</Label>
            <Input
              id="viability"
              type="number"
              min={0}
              max={100}
              step="0.1"
              placeholder="e.g., 95"
              {...form.register("viability")}
              className="min-h-[44px]"
            />
            {form.formState.errors.viability && (
              <p className="text-sm text-destructive">
                {form.formState.errors.viability.message}
              </p>
            )}
          </div>

          {/* 3. Date Measured */}
          <div className="space-y-2">
            <Label htmlFor="measured_date">Date Measured</Label>
            <Input
              id="measured_date"
              type="date"
              {...form.register("measured_date")}
              className="min-h-[44px]"
            />
            <p className="text-sm text-muted-foreground">
              Resets viability decay baseline to this date.
            </p>
            {form.formState.errors.measured_date && (
              <p className="text-sm text-destructive">
                {form.formState.errors.measured_date.message}
              </p>
            )}
          </div>

          {/* Footer */}
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
              disabled={mutation.isPending}
              className="min-h-[44px]"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Record"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
