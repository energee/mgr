/**
 * FermentablesSection - Combined ingredients section for the recipe editor.
 *
 * Wraps GrainBillSection, HopScheduleSection, and OtherIngredientsSection
 * in a single card. Also includes yeast selector, target attenuation, and
 * pitching rate fields. Wires onDataChange callbacks to the recipe editor
 * context for live estimate updates.
 */

"use client";

import { useCallback, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys, entityKeys } from "@/lib/query-keys";
import { updateWithOptimisticLockOrThrow } from "@/lib/optimistic-lock";
import { useDynamicOptions } from "@/hooks/use-dynamic-options";
import { useRecipeEditor, useRegisterSaver } from "./recipe-editor-context";
import { RecipeSectionCard } from "./recipe-section-card";
import { GrainBillSection } from "@/components/domain/grain-bill-section";
import { HopScheduleSection } from "@/components/domain/hop-schedule-section";
import type { GrainBillItem } from "@/components/domain/grain-bill-editor";
import type { HopScheduleItem } from "@/components/domain/hop-schedule-editor";
import { OtherIngredientsSection } from "@/components/domain/other-ingredients-section";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type YeastFormValues = {
  yeast_id: string | null;
  target_attenuation: number | null;
  target_pitching_rate: number | null;
}

/** Field definitions for yeast dropdown */
const YEAST_FIELDS = [
  {
    name: "yeast_id",
    dynamicOptions: {
      table: "yeasts",
      valueField: "id",
      labelField: "name",
      orderBy: "manufacturer,name",
    },
  },
];

export function FermentablesSection() {
  const { recipe, updateRecipe, setGrainItems, setHopItems, startSaving, handleSaveError, getVersion } = useRecipeEditor();
  const supabase = createClient();
  const queryClient = useQueryClient();

  const { optionsMap, isLoading: optionsLoading } = useDynamicOptions(YEAST_FIELDS);
  const yeastOptions = optionsMap.yeast_id ?? [];

  const form = useForm<YeastFormValues>({
    defaultValues: {
      yeast_id: recipe.yeast_id ?? null,
      target_attenuation: recipe.target_attenuation ?? null,
      target_pitching_rate: recipe.target_pitching_rate ?? null,
    },
  });

  const { isDirty } = form.formState;

  // Sync yeast/attenuation to context via form.watch subscription
  const watchedYeast = form.watch("yeast_id");

  useEffect(() => {
    const subscription = form.watch((values) => {
      updateRecipe({
        yeast_id: values.yeast_id,
        target_attenuation: values.target_attenuation,
        target_pitching_rate: values.target_pitching_rate,
      });
    });
    return () => subscription.unsubscribe();
  }, [form, updateRecipe]);

  // Wire grain/hop data changes to context
  const handleGrainChange = useCallback(
    (items: GrainBillItem[]) => {
      setGrainItems(items);
    },
    [setGrainItems]
  );

  const handleHopChange = useCallback(
    (items: HopScheduleItem[]) => {
      setHopItems(items);
    },
    [setHopItems]
  );

  const stopSavingRef = useRef<(() => void) | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (values: YeastFormValues) => {
      stopSavingRef.current = startSaving();
      return updateWithOptimisticLockOrThrow(
        supabase,
        "recipes",
        recipe.id,
        {
          yeast_id: values.yeast_id,
          target_attenuation: values.target_attenuation,
          target_pitching_rate: values.target_pitching_rate,
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

  useRegisterSaver("yeast", isDirty, useCallback(async () => {
    if (!form.formState.isDirty) return;
    await form.handleSubmit(async (values) => {
      await saveMutation.mutateAsync(values);
    })();
  }, [form, saveMutation]));

  return (
    <RecipeSectionCard title="Fermentables & Ingredients" isDirty={isDirty}>
      <div className="space-y-6">
        {/* Grain Bill */}
        <div>
          <h4 className="text-sm font-medium mb-2">Malts & Grains</h4>
          <GrainBillSection
            data={{ id: recipe.id }}
            editing={true}
            onDataChange={handleGrainChange}
          />
        </div>

        {/* Hop Schedule */}
        <div>
          <h4 className="text-sm font-medium mb-2">Hops</h4>
          <HopScheduleSection
            data={{
              id: recipe.id,
              batch_size_bbl: recipe.batch_size_bbl,
              est_og: recipe.est_og,
            }}
            editing={true}
            onDataChange={handleHopChange}
          />
        </div>

        {/* Other Ingredients */}
        <div>
          <h4 className="text-sm font-medium mb-2">Other Ingredients</h4>
          <OtherIngredientsSection data={{ id: recipe.id }} editing={true} />
        </div>

        {/* Yeast + Attenuation + Pitch Rate */}
        <div>
          <h4 className="text-sm font-medium mb-2">Yeast</h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="yeast" className="text-xs">
                Yeast Strain
              </Label>
              <Select
                value={watchedYeast ?? "_none"}
                onValueChange={(v) =>
                  form.setValue("yeast_id", v === "_none" ? null : v, {
                    shouldDirty: true,
                  })
                }
                disabled={optionsLoading}
              >
                <SelectTrigger id="yeast">
                  <SelectValue placeholder="Select yeast..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">None</SelectItem>
                  {yeastOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="attenuation" className="text-xs">
                Target Attenuation %
              </Label>
              <Input
                id="attenuation"
                type="number"
                min="0"
                max="100"
                step="1"
                {...form.register("target_attenuation", { valueAsNumber: true })}
                placeholder="e.g., 75"
              />
            </div>

            <div>
              <Label htmlFor="pitch-rate" className="text-xs">
                Pitching Rate (M cells/mL/°P)
              </Label>
              <Input
                id="pitch-rate"
                type="number"
                min="0"
                step="0.05"
                {...form.register("target_pitching_rate", { valueAsNumber: true })}
                placeholder="e.g., 0.75"
              />
            </div>
          </div>
        </div>
      </div>
    </RecipeSectionCard>
  );
}
