/**
 * WhirlpoolSection - Whirlpool parameters for the recipe editor.
 *
 * Fields: whirlpool_time_min, whirlpool_temp_f, whirlpool_rest_min.
 * Saves independently to the recipes table.
 */

"use client";

import { useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { useRecipeEditor, useRegisterSaver } from "./recipe-editor-context";
import { RecipeSectionCard } from "./recipe-section-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UnitInput } from "@/components/ui/unit-input";

type WhirlpoolFormValues = {
  whirlpool_time_min: number | null;
  whirlpool_temp_f: number | null;
  whirlpool_rest_min: number | null;
}

export function WhirlpoolSection() {
  const { recipe } = useRecipeEditor();

  const form = useForm<WhirlpoolFormValues>({
    defaultValues: {
      whirlpool_time_min: recipe.whirlpool_time_min ?? null,
      whirlpool_temp_f: recipe.whirlpool_temp_f ?? null,
      whirlpool_rest_min: recipe.whirlpool_rest_min ?? null,
    },
  });

  const { isDirty } = form.formState;

  useRegisterSaver("whirlpool", isDirty, useCallback(async () => {
    if (!(await form.trigger())) throw new Error("Whirlpool settings are invalid");
    const values = form.getValues();
    return {
      recipePatch: values,
      onCommitted: () => form.reset(values),
    };
  }, [form]));

  return (
    <RecipeSectionCard
      title="Whirlpool"
      isDirty={isDirty}
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <Label htmlFor="wp-time" className="text-xs">
            Duration (min)
          </Label>
          <Input
            id="wp-time"
            type="number"
            min="0"
            {...form.register("whirlpool_time_min", { valueAsNumber: true })}
            placeholder="e.g., 20"
          />
        </div>
        <div>
          <Label htmlFor="wp-temp" className="text-xs">
            Temperature
          </Label>
          <Controller
            control={form.control}
            name="whirlpool_temp_f"
            render={({ field }) => (
              <UnitInput
                id="wp-temp"
                value={field.value}
                onChange={field.onChange}
                unitType="temperature"
                decimals={0}
              />
            )}
          />
        </div>
        <div>
          <Label htmlFor="wp-rest" className="text-xs">
            Rest (min)
          </Label>
          <Input
            id="wp-rest"
            type="number"
            min="0"
            {...form.register("whirlpool_rest_min", { valueAsNumber: true })}
            placeholder="e.g., 10"
          />
        </div>
      </div>
    </RecipeSectionCard>
  );
}
