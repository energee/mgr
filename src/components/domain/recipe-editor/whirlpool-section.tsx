/**
 * WhirlpoolSection - Whirlpool parameters for the recipe editor.
 *
 * Fields: whirlpool_time_min, whirlpool_temp_f, whirlpool_rest_min.
 * Saves independently to the recipes table.
 */

"use client";

import { useCallback, useRef } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys, entityKeys } from "@/lib/query-keys";
import { updateWithOptimisticLockOrThrow } from "@/lib/optimistic-lock";
import { useRecipeEditor } from "./recipe-editor-context";
import { RecipeSectionCard } from "./recipe-section-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface WhirlpoolFormValues {
  whirlpool_time_min: number | null;
  whirlpool_temp_f: number | null;
  whirlpool_rest_min: number | null;
}

export function WhirlpoolSection() {
  const { recipe, updateRecipe, isSaving, startSaving } = useRecipeEditor();
  const supabase = createClient();
  const queryClient = useQueryClient();

  const form = useForm<WhirlpoolFormValues>({
    defaultValues: {
      whirlpool_time_min: recipe.whirlpool_time_min ?? null,
      whirlpool_temp_f: recipe.whirlpool_temp_f ?? null,
      whirlpool_rest_min: recipe.whirlpool_rest_min ?? null,
    },
  });

  const { isDirty } = form.formState;

  const stopSavingRef = useRef<(() => void) | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (values: WhirlpoolFormValues) => {
      stopSavingRef.current = startSaving();
      return updateWithOptimisticLockOrThrow(
        supabase,
        "recipes",
        recipe.id,
        {
          whirlpool_time_min: values.whirlpool_time_min,
          whirlpool_temp_f: values.whirlpool_temp_f,
          whirlpool_rest_min: values.whirlpool_rest_min,
        },
        recipe.version
      );
    },
    onSuccess: (data) => {
      updateRecipe({ version: data.version });
      form.reset(form.getValues());
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipe.id) });
      queryClient.invalidateQueries({ queryKey: entityKeys.detail("recipes_with_estimates", recipe.id) });
      toast.success("Whirlpool parameters saved");
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
    (values: WhirlpoolFormValues) => saveMutation.mutate(values),
    [saveMutation]
  );

  return (
    <RecipeSectionCard
      title="Whirlpool"
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
            Temperature (°F)
          </Label>
          <Input
            id="wp-temp"
            type="number"
            min="100"
            max="212"
            {...form.register("whirlpool_temp_f", { valueAsNumber: true })}
            placeholder="e.g., 170"
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
