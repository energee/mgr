/**
 * KnockoutSection - Knock-out parameters for the recipe editor.
 *
 * Fields: target_ko_temp_f, target_ko_volume_bbl.
 * Saves independently to the recipes table.
 */

"use client";

import { useCallback, useRef } from "react";
import { useForm, Controller } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys, entityKeys } from "@/lib/query-keys";
import { updateWithOptimisticLockOrThrow } from "@/lib/optimistic-lock";
import { useRecipeEditor, useRegisterSaver } from "./recipe-editor-context";
import { RecipeSectionCard } from "./recipe-section-card";
import { Label } from "@/components/ui/label";
import { UnitInput } from "@/components/ui/unit-input";

type KnockoutFormValues = {
  target_ko_temp_f: number | null;
  target_ko_volume_bbl: number | null;
}

export function KnockoutSection() {
  const { recipe, updateRecipe, startSaving, handleSaveError, getVersion } = useRecipeEditor();
  const supabase = createClient();
  const queryClient = useQueryClient();

  const form = useForm<KnockoutFormValues>({
    defaultValues: {
      target_ko_temp_f: recipe.target_ko_temp_f ?? null,
      target_ko_volume_bbl: recipe.target_ko_volume_bbl ?? null,
    },
  });

  const { isDirty } = form.formState;

  const stopSavingRef = useRef<(() => void) | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (values: KnockoutFormValues) => {
      stopSavingRef.current = startSaving();
      return updateWithOptimisticLockOrThrow(
        supabase,
        "recipes",
        recipe.id,
        {
          target_ko_temp_f: values.target_ko_temp_f,
          target_ko_volume_bbl: values.target_ko_volume_bbl,
        },
        getVersion()
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

  useRegisterSaver("knockout", isDirty, useCallback(async () => {
    if (!form.formState.isDirty) return;
    await form.handleSubmit(async (values) => {
      await saveMutation.mutateAsync(values);
    })();
  }, [form, saveMutation]));

  return (
    <RecipeSectionCard
      title="Knock-Out"
      isDirty={isDirty}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="ko-temp" className="text-xs">
            Target KO Temp
          </Label>
          <Controller
            control={form.control}
            name="target_ko_temp_f"
            render={({ field }) => (
              <UnitInput
                id="ko-temp"
                value={field.value}
                onChange={field.onChange}
                unitType="temperature"
                decimals={0}
              />
            )}
          />
        </div>
        <div>
          <Label htmlFor="ko-volume" className="text-xs">
            Target KO Volume
          </Label>
          <Controller
            control={form.control}
            name="target_ko_volume_bbl"
            render={({ field }) => (
              <UnitInput
                id="ko-volume"
                value={field.value}
                onChange={field.onChange}
                unitType="volume"
                decimals={1}
              />
            )}
          />
        </div>
      </div>
    </RecipeSectionCard>
  );
}
