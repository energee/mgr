/**
 * KnockoutSection - Knock-out parameters for the recipe editor.
 *
 * Fields: target_ko_temp_f, target_ko_volume_bbl.
 * Saves independently to the recipes table.
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface KnockoutFormValues {
  target_ko_temp_f: number | null;
  target_ko_volume_bbl: number | null;
}

export function KnockoutSection() {
  const { recipe, updateRecipe } = useRecipeEditor();
  const supabase = createClient();
  const queryClient = useQueryClient();

  const form = useForm<KnockoutFormValues>({
    defaultValues: {
      target_ko_temp_f: recipe.target_ko_temp_f ?? null,
      target_ko_volume_bbl: recipe.target_ko_volume_bbl ?? null,
    },
  });

  const { isDirty } = form.formState;

  const saveMutation = useMutation({
    mutationFn: async (values: KnockoutFormValues) => {
      return updateWithOptimisticLockOrThrow(
        supabase,
        "recipes",
        recipe.id,
        {
          target_ko_temp_f: values.target_ko_temp_f,
          target_ko_volume_bbl: values.target_ko_volume_bbl,
        },
        recipe.version
      );
    },
    onSuccess: (data) => {
      updateRecipe({ version: data.version });
      form.reset(form.getValues());
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipe.id) });
      queryClient.invalidateQueries({ queryKey: entityKeys.detail("recipes_with_estimates", recipe.id) });
      toast.success("Knock-out parameters saved");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const onSubmit = useCallback(
    (values: KnockoutFormValues) => saveMutation.mutate(values),
    [saveMutation]
  );

  return (
    <RecipeSectionCard
      title="Knock-Out"
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="ko-temp" className="text-xs">
            Target KO Temp (°F)
          </Label>
          <Input
            id="ko-temp"
            type="number"
            min="30"
            max="212"
            step="1"
            {...form.register("target_ko_temp_f", { valueAsNumber: true })}
            placeholder="e.g., 66"
          />
        </div>
        <div>
          <Label htmlFor="ko-volume" className="text-xs">
            Target KO Volume (BBL)
          </Label>
          <Input
            id="ko-volume"
            type="number"
            min="0"
            step="0.1"
            {...form.register("target_ko_volume_bbl", { valueAsNumber: true })}
            placeholder="e.g., 7.0"
          />
        </div>
      </div>
    </RecipeSectionCard>
  );
}
