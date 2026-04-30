/**
 * MashSection - Mash schedule and parameters for the recipe editor.
 *
 * Includes the MashScheduleEditor via form bridge, plus mash temp, pH,
 * efficiency, and water:grain ratio fields. Saves independently.
 */

"use client";

import { useCallback, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys, entityKeys } from "@/lib/query-keys";
import { updateWithOptimisticLockOrThrow } from "@/lib/optimistic-lock";
import { useRecipeEditor, useRegisterSaver } from "./recipe-editor-context";
import { RecipeSectionCard } from "./recipe-section-card";
import { MashScheduleEditor, type MashStep } from "@/components/domain/mash-schedule-editor";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type MashFormValues = {
  mash_temp_f: number | null;
  target_mash_ph: number | null;
  mash_efficiency: number | null;
  mash_schedule: MashStep[] | null;
}

export function MashSection() {
  const { recipe, updateRecipe, startSaving, handleSaveError } = useRecipeEditor();
  const supabase = createClient();
  const queryClient = useQueryClient();

  const form = useForm<MashFormValues>({
    defaultValues: {
      mash_temp_f: recipe.mash_temp_f ?? null,
      target_mash_ph: recipe.target_mash_ph ?? null,
      mash_efficiency: recipe.mash_efficiency ?? null,
      mash_schedule: recipe.mash_schedule ?? null,
    },
  });

  const { isDirty } = form.formState;
  const mashSchedule = form.watch("mash_schedule");
  const watchedEfficiency = form.watch("mash_efficiency");

  useEffect(() => {
    updateRecipe({ mash_efficiency: watchedEfficiency });
  }, [watchedEfficiency, updateRecipe]);

  const stopSavingRef = useRef<(() => void) | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (values: MashFormValues) => {
      stopSavingRef.current = startSaving();
      return updateWithOptimisticLockOrThrow(
        supabase,
        "recipes",
        recipe.id,
        {
          mash_temp_f: values.mash_temp_f,
          target_mash_ph: values.target_mash_ph,
          mash_efficiency: values.mash_efficiency,
          mash_schedule: values.mash_schedule,
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

  useRegisterSaver("mash", isDirty, useCallback(async () => {
    if (!form.formState.isDirty) return;
    await form.handleSubmit(async (values) => {
      await saveMutation.mutateAsync(values);
    })();
  }, [form, saveMutation]));

  return (
    <RecipeSectionCard
      title="Mash"
      isDirty={isDirty}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <Label htmlFor="mash-temp" className="text-xs">
              Mash Temp (°F)
            </Label>
            <Input
              id="mash-temp"
              type="number"
              min="100"
              max="180"
              {...form.register("mash_temp_f", { valueAsNumber: true })}
              placeholder="e.g., 152"
            />
          </div>
          <div>
            <Label htmlFor="mash-ph" className="text-xs">
              Target pH
            </Label>
            <Input
              id="mash-ph"
              type="number"
              step="0.1"
              min="3"
              max="8"
              {...form.register("target_mash_ph", { valueAsNumber: true })}
              placeholder="e.g., 5.4"
            />
          </div>
          <div>
            <Label htmlFor="efficiency" className="text-xs">
              Efficiency %
            </Label>
            <Input
              id="efficiency"
              type="number"
              min="0"
              max="100"
              {...form.register("mash_efficiency", { valueAsNumber: true })}
              placeholder="e.g., 75"
            />
          </div>
          <div>
            <Label className="text-xs">Water:Grain Ratio</Label>
            <div className="h-9 flex items-center text-sm text-muted-foreground">
              {recipe.water_to_grain_ratio
                ? `${recipe.water_to_grain_ratio} qt/lb`
                : "—"}
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium mb-2">Mash Schedule</h4>
          <MashScheduleEditor
            steps={mashSchedule ?? []}
            onChange={(newSteps) => {
              form.setValue("mash_schedule", newSteps, { shouldDirty: true });
            }}
          />
        </div>
      </div>
    </RecipeSectionCard>
  );
}
