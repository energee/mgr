"use client";

/**
 * Yeast Harvest Dialog
 *
 * Record a yeast harvest from a batch's pitched strains. Opens from batch
 * context (not yeast pitch detail). Creates a new yeast_pitch record
 * targeting a brink vessel, using weight (lbs) and thousand-cell counts.
 *
 * The source pitch is NOT updated — it retains its current status since
 * remaining quantity is tracked via the events model.
 *
 * Fields use the shared Form primitives (FormField/FormControl/FormMessage)
 * so validation errors are announced and associated with their inputs
 * (audit A11Y-3).
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/form-resolver";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { unwrap } from "@/lib/supabase/query-helpers";
import { dynamicFrom } from "@/services/types";
import { yeastKeys, vesselKeys, batchKeys } from "@/lib/query-keys";
import { log } from "@/lib/client-logger";

// =============================================================================
// Schema
// =============================================================================

const harvestSchema = z.object({
  source_pitch_id: z.string().uuid("Select source strain"),
  vessel_id: z.string().uuid("Select a brink"),
  quantity_lbs: z.coerce.number().positive("Weight is required"),
  cell_count_thousand: z.coerce.number().min(0).nullable().optional(),
  initial_viability: z.coerce.number().min(0).max(100).nullable().optional(),
  notes: z.string().nullable().optional(),
});

type HarvestFormValues = z.infer<typeof harvestSchema>;

// =============================================================================
// Props
// =============================================================================

type YeastHarvestDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  batchName: string;
  /** Pitch events for this batch — determines which strains can be harvested */
  pitchedStrains: Array<{
    pitch_id: string;
    strain_id: string;
    strain_name: string;
    generation: number;
  }>;
  onSuccess?: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function YeastHarvestDialog({
  open,
  onOpenChange,
  batchId,
  batchName,
  pitchedStrains,
  onSuccess,
}: YeastHarvestDialogProps) {
  const router = useRouter();
  const supabase = createClient();
  const queryClient = useQueryClient();

  const form = useForm<HarvestFormValues>({
    resolver: zodResolver(harvestSchema),
    defaultValues: {
      source_pitch_id: "",
      vessel_id: "",
      quantity_lbs: undefined,
      cell_count_thousand: null,
      initial_viability: 85,
      notes: "",
    },
  });

  // Auto-select if only one pitched strain
  useEffect(() => {
    if (pitchedStrains.length === 1 && !form.getValues("source_pitch_id")) {
      form.setValue("source_pitch_id", pitchedStrains[0].pitch_id);
    }
  }, [pitchedStrains, form]);

  // Fetch available brink vessels
  const { data: brinks, isLoading: brinksLoading } = useQuery({
    queryKey: vesselKeys.brinks(),
    queryFn: async () => {
      return unwrap(
        dynamicFrom(supabase, "vessels")
          .select("id, name, capacity_bbl")
          .eq("vessel_type", "brink")
          .in("status", ["ready_for_use", "in_use"])
          .eq("is_active", true)
          .order("name")
      ) as Promise<{ id: string; name: string; capacity_bbl: number | null }[]>;
    },
    enabled: open,
  });

  // Resolve selected strain from props
  const selectedPitchId = form.watch("source_pitch_id");
  const selectedStrain = pitchedStrains.find(
    (s) => s.pitch_id === selectedPitchId
  );

  // Harvest mutation
  const harvestMutation = useMutation({
    mutationFn: async (values: HarvestFormValues) => {
      const strain = pitchedStrains.find(
        (s) => s.pitch_id === values.source_pitch_id
      );
      if (!strain) throw new Error("Source strain not found");

      const { data: newPitch, error: insertError } = await dynamicFrom(supabase, "yeast_pitches")
        .insert({
          strain_id: strain.strain_id,
          source_type: "harvest",
          parent_pitch_id: values.source_pitch_id,
          status: "in_stock",
          quantity_lbs: values.quantity_lbs,
          cell_count_thousand: values.cell_count_thousand || null,
          initial_viability: values.initial_viability || 85,
          harvest_date: new Date().toISOString().split("T")[0],
          vessel_id: values.vessel_id,
          notes: values.notes || null,
        })
        .select("id, generation")
        .single();

      if (insertError) throw insertError;
      return newPitch as { id: string; generation: number };
    },
    onSuccess: (newPitch) => {
      queryClient.invalidateQueries({ queryKey: yeastKeys.all() });
      queryClient.invalidateQueries({ queryKey: batchKeys.yeast(batchId) });

      const gen = newPitch?.generation ?? (selectedStrain?.generation ?? 0) + 1;
      toast.success("Yeast harvest recorded", {
        description: `Generation ${gen} created`,
      });

      onOpenChange(false);
      form.reset();

      // Navigate to the new pitch detail page
      if (newPitch?.id) {
        router.push(`/production/yeast-pitches/${newPitch.id}`);
      }

      onSuccess?.();
    },
    onError: (error) => {
      log.error("Harvest error:", error);
      toast.error("Failed to record harvest", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    },
  });

  const handleSubmit = form.handleSubmit((values) => {
    harvestMutation.mutate(values);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Harvest Yeast</DialogTitle>
          <DialogDescription>
            Record a yeast harvest from batch{" "}
            <strong>{batchName}</strong>. This will create a new generation
            pitch in the selected brink.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Source Strain */}
          {pitchedStrains.length > 1 ? (
            <FormField
              control={form.control}
              name="source_pitch_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Source Strain</FormLabel>
                  <Select
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select strain..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {pitchedStrains.map((s) => (
                        <SelectItem key={s.pitch_id} value={s.pitch_id}>
                          {s.strain_name} (G{s.generation})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : selectedStrain ? (
            <div className="rounded-md bg-muted p-3">
              <p className="text-sm text-muted-foreground">Source Strain</p>
              <p className="font-medium">
                {selectedStrain.strain_name} (G{selectedStrain.generation})
              </p>
            </div>
          ) : null}

          {/* Destination Brink */}
          <FormField
            control={form.control}
            name="vessel_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Destination Brink</FormLabel>
                {brinksLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading brinks...
                  </div>
                ) : (
                  <Select
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a brink..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {brinks?.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                          {b.capacity_bbl != null && (
                            <span className="text-muted-foreground">
                              {" "}
                              ({b.capacity_bbl} BBL)
                            </span>
                          )}
                        </SelectItem>
                      ))}
                      {brinks?.length === 0 && (
                        <SelectItem value="_none" disabled>
                          No available brinks
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Weight Harvested */}
          <FormField
            control={form.control}
            name="quantity_lbs"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Weight Harvested (lbs)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="e.g., 25"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Cell Count */}
          <FormField
            control={form.control}
            name="cell_count_thousand"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Cell Count (thousand cells)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    placeholder="Optional — measured value"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormDescription>Leave blank if not measured</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Initial Viability */}
          <FormField
            control={form.control}
            name="initial_viability"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Initial Viability (%)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormDescription>
                  Harvested yeast typically starts at 85-95% viability
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Notes */}
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Any observations about this harvest..."
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={harvestMutation.isPending}>
              {harvestMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Recording...
                </>
              ) : (
                "Record Harvest"
              )}
            </Button>
          </DialogFooter>
        </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
