/**
 * FermentationSection - Fermentation schedule and parameters for the recipe editor.
 *
 * Includes the FermentationScheduleEditor plus fermentation_days and
 * conditioning_days fields. Saves independently.
 */

"use client";

import { useCallback } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys, entityKeys } from "@/lib/query-keys";
import { updateWithOptimisticLockOrThrow } from "@/lib/optimistic-lock";
import { useRecipeEditor } from "./recipe-editor-context";
import { RecipeSectionCard } from "./recipe-section-card";
import { FermentationScheduleEditor, type FermentationStage } from "@/components/domain/fermentation-schedule-editor";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface FermentationFormValues {
  fermentation_days: number | null;
  conditioning_days: number | null;
  fermentation_schedule: FermentationStage[] | null;
}

export function FermentationSection() {
  const { recipe, updateRecipe } = useRecipeEditor();
  const supabase = createClient();
  const queryClient = useQueryClient();

  const form = useForm<FermentationFormValues>({
    defaultValues: {
      fermentation_days: recipe.fermentation_days ?? null,
      conditioning_days: recipe.conditioning_days ?? null,
      fermentation_schedule: (recipe.fermentation_schedule as FermentationStage[] | null) ?? null,
    },
  });

  const { isDirty } = form.formState;
  // eslint-disable-next-line react-hooks/incompatible-library
  const fermSchedule = form.watch("fermentation_schedule");

  const saveMutation = useMutation({
    mutationFn: async (values: FermentationFormValues) => {
      return updateWithOptimisticLockOrThrow(
        supabase,
        "recipes",
        recipe.id,
        {
          fermentation_days: values.fermentation_days,
          conditioning_days: values.conditioning_days,
          fermentation_schedule: values.fermentation_schedule,
        },
        recipe.version
      );
    },
    onSuccess: (data) => {
      updateRecipe({ version: data.version });
      form.reset(form.getValues());
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipe.id) });
      queryClient.invalidateQueries({ queryKey: entityKeys.detail("recipes_with_estimates", recipe.id) });
      toast.success("Fermentation parameters saved");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const onSubmit = useCallback(
    (values: FermentationFormValues) => saveMutation.mutate(values),
    [saveMutation]
  );

  return (
    <RecipeSectionCard
      title="Fermentation"
      headerActions={
        isDirty ? (
          <Button
            size="sm"
            onClick={form.handleSubmit(onSubmit)}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Save
          </Button>
        ) : null
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="ferm-days" className="text-xs">
              Fermentation Days
            </Label>
            <Input
              id="ferm-days"
              type="number"
              min="0"
              {...form.register("fermentation_days", { valueAsNumber: true })}
              placeholder="e.g., 14"
            />
          </div>
          <div>
            <Label htmlFor="cond-days" className="text-xs">
              Conditioning Days
            </Label>
            <Input
              id="cond-days"
              type="number"
              min="0"
              {...form.register("conditioning_days", { valueAsNumber: true })}
              placeholder="e.g., 7"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium mb-2">Fermentation Schedule</h4>
          <FermentationScheduleEditor
            stages={(fermSchedule ?? []) as FermentationStage[]}
            onChange={(newStages) => {
              form.setValue("fermentation_schedule", newStages, { shouldDirty: true });
            }}
          />
        </div>
      </div>
    </RecipeSectionCard>
  );
}
