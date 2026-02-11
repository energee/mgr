"use client";

/**
 * Yeast Harvest Dialog
 *
 * Record a yeast harvest from a pitch that is currently in use.
 * Creates a new pitch record with parent_pitch_id linking to source.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/form-resolver";
import { z } from "zod";
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
import { createClient } from "@/lib/supabase/client";
import {
  estimateCellsFromSlurry,
} from "@/lib/yeast-calculations";

// Schema for harvest form
const harvestSchema = z.object({
  volume_ml: z.coerce.number().min(1, "Volume is required"),
  slurry_density: z.enum(["dense", "medium", "thin"]),
  cell_count_billion: z.coerce.number().min(0).nullable().optional(),
  initial_viability: z.coerce.number().min(0).max(100).nullable().optional(),
  location_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
});

type HarvestFormValues = z.infer<typeof harvestSchema>;

interface YeastHarvestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourcePitch: {
    id: string;
    strain_id: string;
    strain_name?: string;
    generation: number;
    batch_id?: string | null;
    batch_name?: string | null;
  };
  locations?: { id: string; name: string }[];
}

export function YeastHarvestDialog({
  open,
  onOpenChange,
  sourcePitch,
  locations = [],
}: YeastHarvestDialogProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<HarvestFormValues>({
    resolver: zodResolver(harvestSchema),
    defaultValues: {
      volume_ml: undefined,
      slurry_density: "medium",
      cell_count_billion: null,
      initial_viability: 85, // Default post-harvest viability
      location_id: null,
      notes: "",
    },
  });

  const watchedVolume = form.watch("volume_ml");
  const watchedDensity = form.watch("slurry_density");
  const watchedViability = form.watch("initial_viability");

  // Calculate estimated cell count based on volume and density
  const estimatedCells =
    watchedVolume && watchedDensity && watchedViability
      ? estimateCellsFromSlurry(
          watchedVolume,
          watchedDensity,
          watchedViability
        )
      : null;

  const newGeneration = sourcePitch.generation + 1;

  async function onSubmit(values: HarvestFormValues) {
    setIsSubmitting(true);

    try {
      const supabase = createClient();

      // Use estimated cell count if not manually entered
      const cellCount =
        values.cell_count_billion ??
        (estimatedCells ? estimatedCells.cellsBillion : null);

      // Create new pitch record for the harvest
      // Note: Table may not be in generated types yet if migration is pending
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: newPitch, error: insertError } = await (supabase as any)
        .from("yeast_pitches")
        .insert({
          strain_id: sourcePitch.strain_id,
          source_type: "harvest",
          parent_pitch_id: sourcePitch.id,
          generation: newGeneration,
          status: "in_stock",
          volume_ml: values.volume_ml,
          cell_count_billion: cellCount,
          initial_viability: values.initial_viability || 85,
          harvest_date: new Date().toISOString().split("T")[0],
          location_id: values.location_id || null,
          notes: values.notes || null,
        })
        .select("id")
        .single();

      if (insertError) throw insertError;

      // Update source pitch status to 'harvested'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateError } = await (supabase as any)
        .from("yeast_pitches")
        .update({ status: "harvested" })
        .eq("id", sourcePitch.id);

      if (updateError) throw updateError;

      toast.success("Yeast harvest recorded", {
        description: `Generation ${newGeneration} created from harvest.`,
      });

      onOpenChange(false);
      router.refresh();

      // Navigate to the new pitch
      if (newPitch?.id) {
        router.push(`/production/yeast-pitches/${newPitch.id}`);
      }
    } catch (error) {
      console.error("Harvest error:", error);
      toast.error("Failed to record harvest", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Harvest Yeast</DialogTitle>
          <DialogDescription>
            Record a yeast harvest from{" "}
            <strong>{sourcePitch.strain_name || "this pitch"}</strong>
            {sourcePitch.batch_name && (
              <> (from batch {sourcePitch.batch_name})</>
            )}
            . This will create a new Generation {newGeneration} pitch.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* Harvest Volume */}
          <div className="grid gap-2">
            <Label htmlFor="volume_ml">Volume Harvested (mL)</Label>
            <Input
              id="volume_ml"
              type="number"
              placeholder="e.g., 500"
              {...form.register("volume_ml")}
            />
            {form.formState.errors.volume_ml && (
              <p className="text-sm text-destructive">
                {form.formState.errors.volume_ml.message}
              </p>
            )}
          </div>

          {/* Slurry Density */}
          <div className="grid gap-2">
            <Label htmlFor="slurry_density">Slurry Density</Label>
            <Select
              value={form.watch("slurry_density")}
              onValueChange={(v) =>
                form.setValue("slurry_density", v as "dense" | "medium" | "thin")
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dense">
                  Dense (~1B cells/mL)
                </SelectItem>
                <SelectItem value="medium">
                  Medium (~0.5B cells/mL)
                </SelectItem>
                <SelectItem value="thin">
                  Thin (~0.25B cells/mL)
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Affects cell count estimation
            </p>
          </div>

          {/* Estimated Cell Count Display */}
          {estimatedCells && (
            <div className="rounded-md bg-muted p-3">
              <p className="text-sm font-medium">Estimated Cell Count</p>
              <p className="text-2xl font-bold">
                {estimatedCells.cellsBillion}B cells
              </p>
              <p className="text-xs text-muted-foreground">
                {estimatedCells.notes}
              </p>
            </div>
          )}

          {/* Override Cell Count */}
          <div className="grid gap-2">
            <Label htmlFor="cell_count_billion">
              Cell Count Override (Billion)
            </Label>
            <Input
              id="cell_count_billion"
              type="number"
              placeholder="Leave blank to use estimate"
              {...form.register("cell_count_billion")}
            />
          </div>

          {/* Initial Viability */}
          <div className="grid gap-2">
            <Label htmlFor="initial_viability">Initial Viability (%)</Label>
            <Input
              id="initial_viability"
              type="number"
              min={0}
              max={100}
              {...form.register("initial_viability")}
            />
            <p className="text-sm text-muted-foreground">
              Harvested yeast typically starts at 85-95% viability
            </p>
          </div>

          {/* Storage Location */}
          {locations.length > 0 && (
            <div className="grid gap-2">
              <Label htmlFor="location_id">Storage Location</Label>
              <Select
                value={form.watch("location_id") || "_none"}
                onValueChange={(v) =>
                  form.setValue("location_id", v === "_none" ? null : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select location..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">No location</SelectItem>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Notes */}
          <div className="grid gap-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Any observations about this harvest..."
              {...form.register("notes")}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Recording..." : "Record Harvest"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
