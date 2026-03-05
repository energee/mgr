/**
 * WaterChemistrySection - Water profiles, volumes, and salt additions for the recipe editor.
 *
 * Renders source/target water profile dropdowns (with WaterProfileQuickCreate),
 * water volume fields, and embeds RecipeAdditionsDisplay for salt calculations.
 * Saves water-related recipe fields independently.
 */

"use client";

import { useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys, entityKeys } from "@/lib/query-keys";
import { updateWithOptimisticLockOrThrow } from "@/lib/optimistic-lock";
import { useDynamicOptions } from "@/hooks/use-dynamic-options";
import { useRecipeEditor } from "./recipe-editor-context";
import { RecipeSectionCard } from "./recipe-section-card";
import { RecipeAdditionsDisplay } from "@/components/domain/recipe-additions-display";
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

interface WaterFormValues {
  water_profile_id: string | null;
  target_water_profile_id: string | null;
  mash_water_volume_gal: number | null;
  sparge_water_volume_gal: number | null;
  preboil_volume_bbl: number | null;
}

const WATER_PROFILE_FIELDS = [
  {
    name: "water_profile_id",
    type: "relation" as const,
    relation: {
      entity: "water_profile",
      displayField: "name",
    },
  },
  {
    name: "target_water_profile_id",
    type: "relation" as const,
    relation: {
      entity: "water_profile",
      displayField: "name",
    },
  },
];

export function WaterChemistrySection() {
  const { recipe, updateRecipe } = useRecipeEditor();
  const supabase = createClient();
  const queryClient = useQueryClient();

  const { optionsMap, isLoading: optionsLoading } = useDynamicOptions(WATER_PROFILE_FIELDS);
  const waterProfileOptions = optionsMap.water_profile_id ?? [];

  const form = useForm<WaterFormValues>({
    defaultValues: {
      water_profile_id: recipe.water_profile_id ?? null,
      target_water_profile_id: recipe.target_water_profile_id ?? null,
      mash_water_volume_gal: recipe.mash_water_volume_gal ?? null,
      sparge_water_volume_gal: recipe.sparge_water_volume_gal ?? null,
      preboil_volume_bbl: recipe.preboil_volume_bbl ?? null,
    },
  });

  const { isDirty } = form.formState;

  // Sync to context
  // eslint-disable-next-line react-hooks/incompatible-library
  const watchedSourceProfile = form.watch("water_profile_id");
  const watchedTargetProfile = form.watch("target_water_profile_id");
  const watchedMashWater = form.watch("mash_water_volume_gal");
  const watchedSpargeWater = form.watch("sparge_water_volume_gal");
  const watchedPreboil = form.watch("preboil_volume_bbl");

  useEffect(() => {
    updateRecipe({
      water_profile_id: watchedSourceProfile,
      target_water_profile_id: watchedTargetProfile,
      mash_water_volume_gal: watchedMashWater,
      sparge_water_volume_gal: watchedSpargeWater,
      preboil_volume_bbl: watchedPreboil,
    });
  }, [watchedSourceProfile, watchedTargetProfile, watchedMashWater, watchedSpargeWater, watchedPreboil, updateRecipe]);

  const saveMutation = useMutation({
    mutationFn: async (values: WaterFormValues) => {
      return updateWithOptimisticLockOrThrow(
        supabase,
        "recipes",
        recipe.id,
        {
          water_profile_id: values.water_profile_id,
          target_water_profile_id: values.target_water_profile_id,
          mash_water_volume_gal: values.mash_water_volume_gal,
          sparge_water_volume_gal: values.sparge_water_volume_gal,
          preboil_volume_bbl: values.preboil_volume_bbl,
        },
        recipe.version
      );
    },
    onSuccess: (data) => {
      updateRecipe({ version: data.version });
      form.reset(form.getValues());
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipe.id) });
      queryClient.invalidateQueries({ queryKey: entityKeys.detail("recipes_with_estimates", recipe.id) });
      toast.success("Water chemistry saved");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const onSubmit = useCallback(
    (values: WaterFormValues) => saveMutation.mutate(values),
    [saveMutation]
  );

  return (
    <RecipeSectionCard
      title="Water Chemistry"
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
      <div className="space-y-6">
        {/* Water profile dropdowns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="source-profile" className="text-xs">
              Source Water Profile
            </Label>
            <Select
              value={watchedSourceProfile ?? "_none"}
              onValueChange={(v) =>
                form.setValue("water_profile_id", v === "_none" ? null : v, {
                  shouldDirty: true,
                })
              }
              disabled={optionsLoading}
            >
              <SelectTrigger id="source-profile">
                <SelectValue placeholder="Select source profile..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">None</SelectItem>
                {waterProfileOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="target-profile" className="text-xs">
              Target Water Profile
            </Label>
            <Select
              value={watchedTargetProfile ?? "_none"}
              onValueChange={(v) =>
                form.setValue(
                  "target_water_profile_id",
                  v === "_none" ? null : v,
                  { shouldDirty: true }
                )
              }
              disabled={optionsLoading}
            >
              <SelectTrigger id="target-profile">
                <SelectValue placeholder="Select target profile..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">None</SelectItem>
                {waterProfileOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Water volumes */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="mash-water" className="text-xs">
              Mash Water (gal)
            </Label>
            <Input
              id="mash-water"
              type="number"
              step="0.5"
              min="0"
              {...form.register("mash_water_volume_gal", { valueAsNumber: true })}
              placeholder="e.g., 100"
            />
          </div>
          <div>
            <Label htmlFor="sparge-water" className="text-xs">
              Sparge Water (gal)
            </Label>
            <Input
              id="sparge-water"
              type="number"
              step="0.5"
              min="0"
              {...form.register("sparge_water_volume_gal", { valueAsNumber: true })}
              placeholder="e.g., 120"
            />
          </div>
          <div>
            <Label htmlFor="preboil-vol" className="text-xs">
              Pre-Boil Volume (BBL)
            </Label>
            <Input
              id="preboil-vol"
              type="number"
              step="0.1"
              min="0"
              {...form.register("preboil_volume_bbl", { valueAsNumber: true })}
              placeholder="e.g., 8.5"
            />
          </div>
        </div>

        {/* Salt additions display (read-only calculations) */}
        <RecipeAdditionsDisplay
          data={{
            id: recipe.id,
            water_profile_id: watchedSourceProfile,
            target_water_profile_id: watchedTargetProfile,
            mash_water_volume_gal: watchedMashWater,
            sparge_water_volume_gal: watchedSpargeWater,
            batch_size_bbl: recipe.batch_size_bbl,
            volume_bbl: recipe.volume_bbl,
          }}
        />
      </div>
    </RecipeSectionCard>
  );
}
