/**
 * RecipeBasicsSection - Compact always-editable row for core recipe fields.
 *
 * Renders name, batch_size_bbl, volume_bbl, boil_time_min, and style/brand
 * dropdowns in a single responsive row. Saves independently to the recipes
 * table via optimistic locking.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys, entityKeys } from "@/lib/query-keys";
import { updateWithOptimisticLockOrThrow } from "@/lib/optimistic-lock";
import { useDynamicOptions } from "@/hooks/use-dynamic-options";
import { useRecipeEditor } from "./recipe-editor-context";
import { RecipeSectionCard } from "./recipe-section-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

type BasicsFormValues = {
  name: string;
  batch_size_bbl: number | null;
  boil_time_min: number | null;
  style_id: string | null;
  brand_id: string | null;
  volume_bbl: number | null;
}

/** Field definitions for useDynamicOptions */
const DYNAMIC_FIELDS = [
  {
    name: "style_id",
    dynamicOptions: {
      table: "beer_styles",
      valueField: "id",
      labelField: "name",
      orderBy: "category,name",
    },
  },
  {
    name: "brand_id",
    dynamicOptions: {
      table: "brands",
      valueField: "id",
      labelField: "name",
      orderBy: "name",
    },
  },
];

export function RecipeBasicsSection() {
  const { recipe, updateRecipe, isSaving, startSaving } = useRecipeEditor();
  const supabase = createClient();
  const queryClient = useQueryClient();

  const { optionsMap, isLoading: optionsLoading } = useDynamicOptions(DYNAMIC_FIELDS);
  const styleOptions = useMemo(() => optionsMap.style_id ?? [], [optionsMap.style_id]);
  const brandOptions = useMemo(() => optionsMap.brand_id ?? [], [optionsMap.brand_id]);

  const form = useForm<BasicsFormValues>({
    defaultValues: {
      name: recipe.name,
      batch_size_bbl: recipe.batch_size_bbl ?? null,
      boil_time_min: recipe.boil_time_min ?? null,
      style_id: recipe.style_id ?? null,
      brand_id: recipe.brand_id ?? null,
      volume_bbl: recipe.volume_bbl ?? null,
    },
  });

  const { isDirty } = form.formState;

  // Keep watches needed for Select value props in JSX
  const watchedStyleId = form.watch("style_id");
  const watchedBrandId = form.watch("brand_id");

  // Single sync to context via form.watch subscription
  useEffect(() => {
    const subscription = form.watch((values) => {
      const styleName = values.style_id
        ? styleOptions.find((o) => o.value === values.style_id)?.label ?? null
        : null;
      updateRecipe({
        name: values.name ?? recipe.name,
        batch_size_bbl: values.batch_size_bbl,
        boil_time_min: values.boil_time_min,
        style_id: values.style_id,
        style_name: styleName,
        brand_id: values.brand_id,
        volume_bbl: values.volume_bbl,
      });
    });
    return () => subscription.unsubscribe();
  }, [form, updateRecipe, styleOptions, recipe.name]);

  const stopSavingRef = useRef<(() => void) | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (values: BasicsFormValues) => {
      stopSavingRef.current = startSaving();
      return updateWithOptimisticLockOrThrow(
        supabase,
        "recipes",
        recipe.id,
        {
          name: values.name,
          batch_size_bbl: values.batch_size_bbl,
          boil_time_min: values.boil_time_min,
          style_id: values.style_id,
          brand_id: values.brand_id,
          volume_bbl: values.volume_bbl,
        },
        recipe.version
      );
    },
    onSuccess: (data) => {
      updateRecipe({ version: data.version });
      form.reset(form.getValues());
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipe.id) });
      queryClient.invalidateQueries({ queryKey: entityKeys.detail("recipes_with_estimates", recipe.id) });
      toast.success("Recipe basics saved");
    },
    onError: (error) => {
      toast.error(error.message);
    },
    onSettled: () => {
      stopSavingRef.current?.();
      stopSavingRef.current = null;
    },
  });

  const onSubmit = useCallback(
    (values: BasicsFormValues) => saveMutation.mutate(values),
    [saveMutation]
  );

  return (
    <RecipeSectionCard
      title="Recipe Basics"
      isDirty={isDirty}
      headerActions={
        isDirty ? (
          <Button
            size="sm"
            onClick={form.handleSubmit(onSubmit)}
            disabled={saveMutation.isPending || isSaving}
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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
        <div className="col-span-2">
          <Label htmlFor="recipe-name" className="text-xs">
            Recipe Name
          </Label>
          <Input
            id="recipe-name"
            {...form.register("name")}
            placeholder="e.g., Hazy Days IPA"
          />
        </div>

        <div>
          <Label htmlFor="batch-size" className="text-xs">
            Batch Size (BBL)
          </Label>
          <Input
            id="batch-size"
            type="number"
            step="0.5"
            min="0"
            {...form.register("batch_size_bbl", { valueAsNumber: true })}
            placeholder="e.g., 7"
          />
        </div>

        <div>
          <Label htmlFor="volume-bbl" className="text-xs">
            Recipe Volume (BBL)
          </Label>
          <Input
            id="volume-bbl"
            type="number"
            step="0.5"
            min="0"
            {...form.register("volume_bbl", { valueAsNumber: true })}
            placeholder="e.g., 7"
          />
        </div>

        <div>
          <Label htmlFor="boil-time" className="text-xs">
            Boil Time (min)
          </Label>
          <Input
            id="boil-time"
            type="number"
            min="0"
            {...form.register("boil_time_min", { valueAsNumber: true })}
            placeholder="e.g., 60"
          />
        </div>

        <div>
          <Label htmlFor="style" className="text-xs">
            Style
          </Label>
          <Select
            value={watchedStyleId ?? "_none"}
            onValueChange={(v) =>
              form.setValue("style_id", v === "_none" ? null : v, {
                shouldDirty: true,
              })
            }
            disabled={optionsLoading}
          >
            <SelectTrigger id="style">
              <SelectValue placeholder="Select style..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">None</SelectItem>
              {styleOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="brand" className="text-xs">
            Brand
          </Label>
          <Select
            value={watchedBrandId ?? "_none"}
            onValueChange={(v) =>
              form.setValue("brand_id", v === "_none" ? null : v, {
                shouldDirty: true,
              })
            }
            disabled={optionsLoading}
          >
            <SelectTrigger id="brand">
              <SelectValue placeholder="Select brand..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">None</SelectItem>
              {brandOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </RecipeSectionCard>
  );
}
