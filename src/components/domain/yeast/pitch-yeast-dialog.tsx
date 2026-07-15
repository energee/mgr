"use client";

/**
 * Pitch Yeast Dialog
 *
 * Records a yeast pitch event from a brink/purchase into a batch.
 * Deducts quantity from the source pitch via yeast_pitch_events,
 * calculates pitch rate from batch volume and OG, and suggests
 * a batch state transition after successful pitching.
 *
 * Fields use the shared Form primitives (FormField/FormControl/FormMessage)
 * so validation errors are announced and associated with their inputs
 * (audit A11Y-3).
 */

import { useEffect, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/form-resolver";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { FormActions } from "@/components/ui/form-actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { batchKeys, entityKeys, yeastKeys } from "@/lib/query-keys";
import {
  calculatePitchingRate,
  calculatePitchWeightLbs,
  sgToPlato,
  formatCellCount,
} from "@/domain/yeast-calculations";
import { log } from "@/lib/client-logger";
import { parseUnknownError, PG_ERROR_CODES } from "@/lib/errors";

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

type PitchYeastRpcResult = {
  kind: "created" | "duplicate";
  event_id: string;
  remaining_quantity_lbs: number;
  status: string;
};

type PitchCommandIdentity = {
  requestId: string;
  fingerprint: string | null;
};

/** Row shape returned from yeast_pitches_with_remaining view. */
type AvailablePitch = {
  id: string;
  strain_id: string;
  strain_name: string;
  generation: number;
  quantity_remaining_lbs: number;
  estimated_viability: number;
  cell_density_thousand: number | null;
  status: string;
}

type PitchYeastDialogProps = {
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
  const requestIdentityRef = useRef<PitchCommandIdentity | null>(null);
  if (!requestIdentityRef.current) {
    requestIdentityRef.current = {
      requestId: crypto.randomUUID(),
      fingerprint: null,
    };
  }

  const resetRequestIdentity = () => {
    requestIdentityRef.current = {
      requestId: crypto.randomUUID(),
      fingerprint: null,
    };
  };

  // ---------------------------------------------------------------------------
  // Fetch available yeast pitches (in_stock with remaining quantity)
  // ---------------------------------------------------------------------------
  const { data: pitches, isLoading: pitchesLoading } = useQuery({
    queryKey: yeastKeys.available(),
    queryFn: async () => {
      return await unwrap(
        dynamicFrom(supabase, "yeast_pitches_with_remaining")
          .select(
            "id, strain_id, strain_name, generation, quantity_remaining_lbs, estimated_viability, cell_density_thousand, status"
          )
          .eq("status", "in_stock")
          .gt("quantity_remaining_lbs", 0)
          .order("strain_name"),
      ) as unknown as AvailablePitch[];
    },
    enabled: open,
  });

  // ---------------------------------------------------------------------------
  // Fetch strains' recommended_max_generations (the view above doesn't expose
  // it) so we can warn — without blocking — when a pitch is at or past the
  // strain's recommended generation limit.
  // ---------------------------------------------------------------------------
  const { data: strainMaxGenerations } = useQuery({
    queryKey: yeastKeys.strainMaxGenerations(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("yeasts")
        .select("id, recommended_max_generations");
      if (error) throw error;
      return new Map(
        (data ?? []).map((y) => [y.id, y.recommended_max_generations])
      );
    },
    enabled: open,
  });

  /** Recommended max generations for a pitch's strain (null = no limit set). */
  const getMaxGenerations = (pitch: AvailablePitch): number | null =>
    strainMaxGenerations?.get(pitch.strain_id) ?? null;

  /** True when the pitch is at or past its strain's recommended generation limit. */
  const isOverGeneration = (pitch: AvailablePitch): boolean => {
    const maxGen = getMaxGenerations(pitch);
    return maxGen != null && pitch.generation >= maxGen;
  };

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
  const invalidatePitchCaches = (pitchId: string) => Promise.all([
    // yeastKeys.all is the prefix for the available-source query as well as
    // source details, so a concurrent depletion cannot remain selectable.
    queryClient.invalidateQueries({ queryKey: yeastKeys.all() }),
    queryClient.invalidateQueries({ queryKey: yeastKeys.events(pitchId) }),
    queryClient.invalidateQueries({ queryKey: batchKeys.yeastSummary(batchId) }),
    queryClient.invalidateQueries({ queryKey: batchKeys.yeastStrains(batchId) }),
    queryClient.invalidateQueries({
      queryKey: entityKeys.all("yeast_pitches_with_remaining"),
    }),
    queryClient.invalidateQueries({
      queryKey: entityKeys.all("yeast_pitch_events"),
    }),
    queryClient.invalidateQueries({ queryKey: yeastKeys.lineageAll() }),
    queryClient.invalidateQueries({ queryKey: yeastKeys.lineageSummaryAll() }),
  ]);

  const pitchMutation = useMutation({
    mutationFn: async (values: PitchYeastFormValues) => {
      const pitch = sortedPitches.find((p) => p.id === values.pitch_id);
      if (!pitch) throw new Error("Selected yeast pitch not found");
      const fingerprint = JSON.stringify({
        pitchId: values.pitch_id,
        batchId,
        quantityLbs: values.quantity_lbs,
        viability: values.viability,
        notes: values.notes || "",
      });
      const identity = requestIdentityRef.current;
      if (!identity) throw new Error("Yeast pitch request identity is unavailable");
      if (identity.fingerprint && identity.fingerprint !== fingerprint) {
        throw new Error(
          "This retry changed an unresolved yeast pitch. Retry with the original values, or close and reopen the dialog to start a new pitch.",
        );
      }
      identity.fingerprint = fingerprint;

      const result = await unwrap(
        supabase.rpc("pitch_yeast_atomic", {
          p_request_id: identity.requestId,
          p_pitch_id: values.pitch_id,
          p_batch_id: batchId,
          p_quantity_lbs: values.quantity_lbs,
          p_viability_at_pitch: values.viability,
          p_notes: values.notes || "",
        }),
      );

      return {
        pitch,
        quantity: values.quantity_lbs,
        result: result as PitchYeastRpcResult,
      };
    },
    onSuccess: async ({ pitch, quantity, result }) => {
      // No cache or UI state changes until the database confirms created or
      // duplicate (the latter reconciles an ambiguous response after commit).
      await invalidatePitchCaches(pitch.id);
      resetRequestIdentity();

      toast.success(result.kind === "duplicate"
        ? "This yeast pitch was already recorded"
        : `Pitched ${quantity} lbs of ${pitch.strain_name} (G${pitch.generation})`
      );

      onOpenChange(false);
      form.reset();

      // Suggest state transition if batch is in "planned" status
      if (
        result.kind === "created"
        && batchStatus === "planned"
        && onSuggestTransition
      ) {
        onSuggestTransition("fermenting");
      }

      onSuccess?.();
    },
    onError: async (error, values) => {
      log.error("Pitch yeast error:", error);
      const parsed = parseUnknownError(error);
      const isConflict =
        typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === PG_ERROR_CODES.CONFLICT
        && "message" in error;
      const isBalanceConflict = isConflict
        && typeof error.message === "string"
        && error.message.startsWith("Cannot pitch");
      if (isConflict) {
        // PT409 is a definitive rolled-back command, but it often means a
        // concurrent writer changed the source. Reconcile every affected view
        // before allowing a new request identity.
        await invalidatePitchCaches(values.pitch_id);
        resetRequestIdentity();
      }
      if (isBalanceConflict) {
        form.setError("quantity_lbs", { message: parsed.message });
      }
      toast.error(parsed.message);
    },
  });

  const handleSubmit = form.handleSubmit((values) => {
    pitchMutation.mutate(values);
  });

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !pitchMutation.isPending) {
      resetRequestIdentity();
    }
    onOpenChange(nextOpen);
  };

  // ---------------------------------------------------------------------------
  // Helpers for display
  // ---------------------------------------------------------------------------
  const isRecipeMatch = (pitch: AvailablePitch) =>
    recipeYeastIds?.includes(pitch.strain_id) ?? false;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Pitch Yeast</DialogTitle>
          <DialogDescription>
            Pitch yeast into batch <strong>{batchName}</strong> from an
            available brink or purchase.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 1. Yeast Source Select */}
          <FormField
            control={form.control}
            name="pitch_id"
            render={({ field }) => (
              <FormItem>
            <FormLabel>Yeast Source</FormLabel>
            <Select
              value={field.value}
              onValueChange={field.onChange}
              disabled={pitchesLoading}
            >
              <FormControl>
                <SelectTrigger className="min-h-[44px]">
                  <SelectValue
                    placeholder={
                      pitchesLoading ? "Loading..." : "Select yeast source..."
                    }
                  />
                </SelectTrigger>
              </FormControl>
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
                      {isOverGeneration(pitch) && (
                        <span className="ml-1 text-xs text-amber-600 font-medium">
                          Over gen limit
                        </span>
                      )}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <FormMessage />
            {/* Generation warning — informational only, never blocks pitching */}
            {selectedPitch && isOverGeneration(selectedPitch) && (
              <p className="text-sm text-amber-600 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Generation {selectedPitch.generation} is at or past the
                recommended max of {getMaxGenerations(selectedPitch)} for this
                strain. You can still pitch, but viability and flavor may
                drift.
              </p>
            )}
              </FormItem>
            )}
          />

          {/* 2. Viability */}
          <FormField
            control={form.control}
            name="viability"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Viability (%)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.1"
                    className="min-h-[44px]"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormDescription>
                  Estimated from decay. Override if measured.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

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
          <FormField
            control={form.control}
            name="quantity_lbs"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Quantity (lbs)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="e.g., 2.5"
                    className="min-h-[44px]"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

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
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Notes (optional)</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Pitch notes..."
                    rows={2}
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* 7. Footer */}
          <DialogFooter>
            <FormActions
              submitLabel="Pitch Yeast"
              loadingLabel="Pitching..."
              isLoading={pitchMutation.isPending}
              submitDisabled={!sortedPitches.length || isOverdrawing}
              onCancel={() => handleOpenChange(false)}
            />
          </DialogFooter>
        </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
