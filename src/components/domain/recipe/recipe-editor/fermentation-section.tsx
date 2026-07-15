/**
 * FermentationSection - Fermentation schedule and parameters for the recipe editor.
 *
 * Includes the FermentationScheduleEditor plus fermentation_days and
 * conditioning_days fields. Saves independently.
 */

"use client";

import { useCallback } from "react";
import { useForm } from "react-hook-form";
import { useRecipeEditor, useRegisterSaver } from "./recipe-editor-context";
import { RecipeSectionCard } from "./recipe-section-card";
import { FermentationScheduleEditor, type FermentationStage } from "@/components/domain/recipe/fermentation-schedule-editor";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FermentationFormValues = {
  fermentation_days: number | null;
  conditioning_days: number | null;
  fermentation_schedule: FermentationStage[] | null;
}

export function FermentationSection() {
  const { recipe } = useRecipeEditor();

  const form = useForm<FermentationFormValues>({
    defaultValues: {
      fermentation_days: recipe.fermentation_days ?? null,
      conditioning_days: recipe.conditioning_days ?? null,
      fermentation_schedule: recipe.fermentation_schedule ?? null,
    },
  });

  const { isDirty } = form.formState;
  const fermSchedule = form.watch("fermentation_schedule");

  useRegisterSaver("fermentation", isDirty, useCallback(async () => {
    if (!(await form.trigger())) throw new Error("Fermentation settings are invalid");
    const values = form.getValues();
    return {
      recipePatch: values,
      onCommitted: () => form.reset(values),
    };
  }, [form]));

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
