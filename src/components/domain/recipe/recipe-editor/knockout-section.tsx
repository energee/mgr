/**
 * KnockoutSection - Knock-out parameters for the recipe editor.
 *
 * Fields: target_ko_temp_f, target_ko_volume_bbl.
 * Saves independently to the recipes table.
 */

"use client";

import { useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { useRecipeEditor, useRegisterSaver } from "./recipe-editor-context";
import { RecipeSectionCard } from "./recipe-section-card";
import { Label } from "@/components/ui/label";
import { UnitInput } from "@/components/ui/unit-input";

type KnockoutFormValues = {
  target_ko_temp_f: number | null;
  target_ko_volume_bbl: number | null;
}

export function KnockoutSection() {
  const { recipe } = useRecipeEditor();

  const form = useForm<KnockoutFormValues>({
    defaultValues: {
      target_ko_temp_f: recipe.target_ko_temp_f ?? null,
      target_ko_volume_bbl: recipe.target_ko_volume_bbl ?? null,
    },
  });

  const { isDirty } = form.formState;

  useRegisterSaver("knockout", isDirty, useCallback(async () => {
    if (!(await form.trigger())) throw new Error("Knock-out settings are invalid");
    const values = form.getValues();
    return {
      recipePatch: values,
      onCommitted: () => form.reset(values),
    };
  }, [form]));

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
