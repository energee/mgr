/**
 * FermentationSection - Fermentation schedule and parameters for the recipe editor.
 *
 * Includes the FermentationScheduleEditor plus fermentation_days and
 * conditioning_days fields. Saves independently.
 */

"use client";

import { useCallback, useRef } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys, entityKeys } from "@/lib/query-keys";
import { updateWithOptimisticLockOrThrow } from "@/lib/optimistic-lock";
import { useRecipeEditor, useRegisterSaver } from "./recipe-editor-context";
import { RecipeSectionCard } from "./recipe-section-card";
import { FermentationScheduleEditor, type FermentationStage } from "@/components/domain/fermentation-schedule-editor";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FermentationFormValues = {
  fermentation_days: number | null;
  conditioning_days: number | null;
  fermentation_schedule: FermentationStage[] | null;
}

export function FermentationSection() {
  const { recipe, updateRecipe, startSaving, handleSaveError } = useRecipeEditor();
  const supabase = createClient();
  const queryClient = useQueryClient();

  const form = useForm<FermentationFormValues>({
    defaultValues: {
      fermentation_days: recipe.fermentation_days ?? null,
      conditioning_days: recipe.conditioning_days ?? null,
      fermentation_schedule: recipe.fermentation_schedule ?? null,
    },
  });

  const { isDirty } = form.formState;
  const fermSchedule = form.watch("fermentation_schedule");

  const stopSavingRef = useRef<(() => void) | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (values: FermentationFormValues) => {
      stopSavingRef.current = startSaving();
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
    },
    onError: handleSaveError,
    onSettled: () => {
      stopSavingRef.current?.();
      stopSavingRef.current = null;
    },
  });

  useRegisterSaver("fermentation", isDirty, useCallback(async () => {
    if (!form.formState.isDirty) return;
    await form.handleSubmit(async (values) => {
      await saveMutation.mutateAsync(values);
    })();
  }, [form, saveMutation]));

  return (
    <RecipeSectionCard
      title="Fermentation"
      isDirty={isDirty}
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
            stages={fermSchedule ?? []}
            onChange={(newStages) => {
              form.setValue("fermentation_schedule", newStages, { shouldDirty: true });
            }}
          />
        </div>
      </div>
    </RecipeSectionCard>
  );
}
