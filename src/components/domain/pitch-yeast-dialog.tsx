"use client";

/**
 * Pitch Yeast Dialog
 *
 * Records a yeast pitch event from a brink/purchase into a batch.
 * Deducts quantity from the source pitch via yeast_pitch_events,
 * calculates pitch rate from batch volume and OG, and suggests
 * a batch state transition after successful pitching.
 */

import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/form-resolver";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom } from "@/services/types";
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
import { Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { yeastKeys, batchKeys } from "@/lib/query-keys";
import {
  calculatePitchingRate,
  calculatePitchWeightLbs,
  sgToPlato,
  formatCellCount,
} from "@/lib/yeast-calculations";

// =============================================================================
// Types
// =============================================================================

const pitchYeastSchema = z.object({
  pitch_id: z.string().uuid("Select a yeast source"),
  viability: z.coerce.number().min(0).max(100),
  quantity_lbs: z.coerce.number().positive("Quantity must be positive"),
  notes: z.string().nullable().optional(),
});

type PitchYeastFormValues = z.infer<typeof pitchYeastSchema>;

/** Row shape returned from yeast_pitches_with_remaining view. */
interface AvailablePitch {
  id: string;
  strain_id: string;
  strain_name: string;
  generation: number;
  quantity_remaining_lbs: number;
  estimated_viability: number;
  cell_density_thousand: number | null;
  status: string;
}

interface PitchYeastDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  batchName: string;
  batchStatus?: string;
  batchVolumeBbl?: number | null;
  recipeOg?: number | null;
  /** Strain IDs from recipe_yeasts -- highlight matching pitches */
  recipeYeastIds?: string[];
  /** When opening from yeast pitch detail page */
  preselectedPitchId?: string;
  onSuccess?: () => void;
  /** Called after successful pitch to suggest a batch state transition */
  onSuggestTransition?: (toState: string) => void;
}

// =============================================================================
// Component
// =============================================================================

export function PitchYeastDialog({
  open,
  onOpenChange,
  batchId,
  batchName,
  batchStatus,
  batchVolumeBbl,
  recipeOg,
  recipeYeastIds,
  preselectedPitchId,
  onSuccess,
  onSuggestTransition,
}: PitchYeastDialogProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  // ---------------------------------------------------------------------------
  // Fetch available yeast pitches (in_stock with remaining quantity)
  // ---------------------------------------------------------------------------
  const { data: pitches, isLoading: pitchesLoading } = useQuery({
    queryKey: yeastKeys.available(),
    queryFn: async () => {
      const { data, error } = await dynamicFrom(supabase, "yeast_pitches_with_remaining")
        .select(
          "id, strain_id, strain_name, generation, quantity_remaining_lbs, estimated_viability, cell_density_thousand, status"
        )
        .eq("status", "in_stock")
        .gt("quantity_remaining_lbs", 0)
        .order("strain_name");
      if (error) throw error;
      return data as AvailablePitch[];
    },
    enabled: open,
  });

  // Sort recipe-matching strains first if recipeYeastIds provided
  const sortedPitches = useMemo(() => {
    if (!pitches) return [];
    if (!recipeYeastIds || recipeYeastIds.length === 0) return pitches;

    const matching = pitches.filter((p) =>
      recipeYeastIds.includes(p.strain_id)
    );
    const nonMatching = pitches.filter(
      (p) => !recipeYeastIds.includes(p.strain_id)
    );
    return [...matching, ...nonMatching];
  }, [pitches, recipeYeastIds]);

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  const form = useForm<PitchYeastFormValues>({
    resolver: zodResolver(pitchYeastSchema),
    defaultValues: {
      pitch_id: preselectedPitchId || "",
      viability: 95,
      quantity_lbs: undefined,
      notes: "",
    },
  });

  const selectedPitchId = form.watch("pitch_id");
  const watchedViability = form.watch("viability");
  const watchedQuantity = form.watch("quantity_lbs");

  const selectedPitch = sortedPitches.find((p) => p.id === selectedPitchId);

  // When a pitch is selected, pre-fill viability from its estimated_viability
  useEffect(() => {
    if (selectedPitch) {
      form.setValue("viability", selectedPitch.estimated_viability);
    }
  }, [selectedPitch, form]);

  // Pre-select pitch if preselectedPitchId is provided and pitches are loaded
  useEffect(() => {
    if (preselectedPitchId && pitches?.some((p) => p.id === preselectedPitchId)) {
      form.setValue("pitch_id", preselectedPitchId);
    }
  }, [preselectedPitchId, pitches, form]);

  // ---------------------------------------------------------------------------
  // Pitch rate calculation
  // ---------------------------------------------------------------------------
  const pitchCalc = useMemo(() => {
    if (!selectedPitch || !batchVolumeBbl || !recipeOg) return null;

    const ogPlato = sgToPlato(recipeOg);
    const { cellsNeeded } = calculatePitchingRate(batchVolumeBbl, ogPlato);

    if (!selectedPitch.cell_density_thousand) {
      return { cellsNeeded, lbsNeeded: null, noDensity: true };
    }

    const lbsNeeded = calculatePitchWeightLbs(
      cellsNeeded,
      selectedPitch.cell_density_thousand,
      watchedViability
    );

    return { cellsNeeded, lbsNeeded, noDensity: false };
  }, [selectedPitch, batchVolumeBbl, recipeOg, watchedViability]);

  // Auto-fill quantity from calculation
  useEffect(() => {
    if (pitchCalc?.lbsNeeded != null) {
      form.setValue("quantity_lbs", pitchCalc.lbsNeeded);
    }
  }, [pitchCalc?.lbsNeeded, form]);

  // Remaining after pitch
  const remainingAfterPitch =
    selectedPitch && watchedQuantity
      ? selectedPitch.quantity_remaining_lbs - watchedQuantity
      : null;

  const isOverdrawing =
    remainingAfterPitch !== null && remainingAfterPitch < 0;

  // ---------------------------------------------------------------------------
  // Submit mutation
  // ---------------------------------------------------------------------------
  const pitchMutation = useMutation({
    mutationFn: async (values: PitchYeastFormValues) => {
      const pitch = sortedPitches.find((p) => p.id === values.pitch_id);
      if (!pitch) throw new Error("Selected yeast pitch not found");

      // Calculate cells pitched (thousands)
      const cellsPitchedThousand =
        pitch.cell_density_thousand && values.viability
          ? values.quantity_lbs *
            pitch.cell_density_thousand *
            (values.viability / 100)
          : null;

      // Insert yeast_pitch_event
      const { error: insertError } = await dynamicFrom(supabase, "yeast_pitch_events")
        .insert({
          pitch_id: values.pitch_id,
          batch_id: batchId,
          quantity_lbs: values.quantity_lbs,
          cells_pitched_thousand: cellsPitchedThousand
            ? Math.round(cellsPitchedThousand * 100) / 100
            : null,
          viability_at_pitch: values.viability,
          pitched_at: new Date().toISOString(),
          notes: values.notes || null,
        });

      if (insertError) throw insertError;

      // Check if remaining would be <= 0 after this pitch
      const newRemaining =
        pitch.quantity_remaining_lbs - values.quantity_lbs;
      if (newRemaining <= 0) {
        const { error: statusError } = await dynamicFrom(supabase, "yeast_pitches")
          .update({ status: "depleted" })
          .eq("id", values.pitch_id);

        if (statusError) throw statusError;
      }

      return { pitch, quantity: values.quantity_lbs };
    },
    onSuccess: ({ pitch, quantity }) => {
      // Invalidate relevant caches
      queryClient.invalidateQueries({ queryKey: yeastKeys.all() });
      queryClient.invalidateQueries({ queryKey: yeastKeys.detail(pitch.id) });
      queryClient.invalidateQueries({ queryKey: batchKeys.yeast(batchId) });

      toast.success(
        `Pitched ${quantity} lbs of ${pitch.strain_name} (G${pitch.generation})`
      );

      onOpenChange(false);
      form.reset();

      // Suggest state transition if batch is in "planned" status
      if (batchStatus === "planned" && onSuggestTransition) {
        onSuggestTransition("fermenting");
      }

      onSuccess?.();
    },
    onError: (error) => {
      console.error("Pitch yeast error:", error);
      const message =
        error instanceof Error ? error.message : "Failed to pitch yeast";
      toast.error(message);
    },
  });

  const handleSubmit = form.handleSubmit((values) => {
    pitchMutation.mutate(values);
  });

  // ---------------------------------------------------------------------------
  // Helpers for display
  // ---------------------------------------------------------------------------
  const isRecipeMatch = (pitch: AvailablePitch) =>
    recipeYeastIds?.includes(pitch.strain_id) ?? false;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Pitch Yeast</DialogTitle>
          <DialogDescription>
            Pitch yeast into batch <strong>{batchName}</strong> from an
            available brink or purchase.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 1. Yeast Source Select */}
          <div className="space-y-2">
            <Label htmlFor="pitch_id">Yeast Source</Label>
            <Select
              value={selectedPitchId}
              onValueChange={(v) => form.setValue("pitch_id", v)}
              disabled={pitchesLoading}
            >
              <SelectTrigger className="min-h-[44px]">
                <SelectValue
                  placeholder={
                    pitchesLoading ? "Loading..." : "Select yeast source..."
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {sortedPitches.length === 0 ? (
                  <div className="p-2 text-sm text-muted-foreground text-center">
                    No yeast available
                  </div>
                ) : (
                  sortedPitches.map((pitch) => (
                    <SelectItem key={pitch.id} value={pitch.id}>
                      <span className="font-medium">
                        {pitch.strain_name}
                      </span>
                      <span className="text-muted-foreground ml-2">
                        (G{pitch.generation}) &mdash;{" "}
                        {pitch.quantity_remaining_lbs} lbs, ~
                        {Math.round(pitch.estimated_viability)}% viability
                      </span>
                      {isRecipeMatch(pitch) && (
                        <span className="ml-1 text-xs text-emerald-600 font-medium">
                          Recipe match
                        </span>
                      )}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {form.formState.errors.pitch_id && (
              <p className="text-sm text-destructive">
                {form.formState.errors.pitch_id.message}
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
              {...form.register("viability")}
              className="min-h-[44px]"
            />
            <p className="text-sm text-muted-foreground">
              Estimated from decay. Override if measured.
            </p>
            {form.formState.errors.viability && (
              <p className="text-sm text-destructive">
                {form.formState.errors.viability.message}
              </p>
            )}
          </div>

          {/* 3. Pitch Rate Calculation Display */}
          {pitchCalc && (
            <div className="rounded-md bg-muted p-3 space-y-1">
              <p className="text-sm font-medium">Calculated Pitch Rate</p>
              {pitchCalc.noDensity ? (
                <p className="text-sm text-muted-foreground">
                  Cell density unknown &mdash; enter quantity manually
                </p>
              ) : (
                <p className="text-sm">
                  Need {formatCellCount(pitchCalc.cellsNeeded)} cells
                  &rarr; <strong>{pitchCalc.lbsNeeded} lbs</strong> from this
                  brink
                </p>
              )}
            </div>
          )}

          {/* 4. Quantity */}
          <div className="space-y-2">
            <Label htmlFor="quantity_lbs">Quantity (lbs)</Label>
            <Input
              id="quantity_lbs"
              type="number"
              step="0.1"
              placeholder="e.g., 2.5"
              {...form.register("quantity_lbs")}
              className="min-h-[44px]"
            />
            {form.formState.errors.quantity_lbs && (
              <p className="text-sm text-destructive">
                {form.formState.errors.quantity_lbs.message}
              </p>
            )}
          </div>

          {/* 5. Remaining display / overdraw warning */}
          {selectedPitch && watchedQuantity > 0 && (
            <div className="space-y-1">
              {isOverdrawing ? (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4" />
                  Cannot pitch: brink only has{" "}
                  {selectedPitch.quantity_remaining_lbs} lbs remaining
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Brink will have{" "}
                  {remainingAfterPitch !== null
                    ? remainingAfterPitch.toFixed(1)
                    : "?"}{" "}
                  lbs remaining after pitch.
                </p>
              )}
            </div>
          )}

          {/* 6. Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              {...form.register("notes")}
              placeholder="Pitch notes..."
              rows={2}
            />
          </div>

          {/* 7. Footer */}
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
              disabled={pitchMutation.isPending || !sortedPitches.length || isOverdrawing}
              className="min-h-[44px]"
            >
              {pitchMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Pitching...
                </>
              ) : (
                "Pitch Yeast"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
