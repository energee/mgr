/**
 * WaterChemistrySection - Water profiles, volumes, and salt additions for the recipe editor.
 *
 * Renders source/target water profile dropdowns (with WaterProfileQuickCreate),
 * water volume fields, and embeds RecipeAdditionsDisplay for salt calculations.
 * Saves water-related recipe fields independently.
 */

"use client";

import { useCallback, useEffect, useRef } from "react";
import { useForm, Controller } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys, entityKeys } from "@/lib/query-keys";
import { updateWithOptimisticLockOrThrow } from "@/lib/optimistic-lock";
import { useDynamicOptions } from "@/hooks/use-dynamic-options";
import { useRecipeEditor, useRegisterSaver } from "./recipe-editor-context";
import { RecipeSectionCard } from "./recipe-section-card";
import { RecipeAdditionsDisplay } from "@/components/domain/recipe/recipe-additions-display";
import { Label } from "@/components/ui/label";
import { UnitInput } from "@/components/ui/unit-input";
import { convertVolume } from "@/domain/units";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type WaterFormValues = {
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
  const { recipe, updateRecipe, startSaving, handleSaveError, getVersion } = useRecipeEditor();
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
  const watchedSourceProfile = form.watch("water_profile_id");
  const watchedTargetProfile = form.watch("target_water_profile_id");
  const watchedMashWater = form.watch("mash_water_volume_gal");
  const watchedSpargeWater = form.watch("sparge_water_volume_gal");
  useEffect(() => {
    const subscription = form.watch((values) => {
      updateRecipe({
        water_profile_id: values.water_profile_id,
        target_water_profile_id: values.target_water_profile_id,
        mash_water_volume_gal: values.mash_water_volume_gal,
        sparge_water_volume_gal: values.sparge_water_volume_gal,
        preboil_volume_bbl: values.preboil_volume_bbl,
      });
    });
    return () => subscription.unsubscribe();
  }, [form, updateRecipe]);

  const stopSavingRef = useRef<(() => void) | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (values: WaterFormValues) => {
      stopSavingRef.current = startSaving();
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

  useRegisterSaver("water-chemistry", isDirty, useCallback(async () => {
    if (!form.formState.isDirty) return;
    await form.handleSubmit(async (values) => {
      await saveMutation.mutateAsync(values);
    })();
  }, [form, saveMutation]));

  return (
    <RecipeSectionCard
      title="Water Chemistry"
      isDirty={isDirty}
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
              Mash Water
            </Label>
            <Controller
              control={form.control}
              name="mash_water_volume_gal"
              render={({ field }) => (
                <UnitInput
                  id="mash-water"
                  // Stored canonical for this column is gallons; UnitInput's
                  // volume canonical is BBL, so convert at the boundary.
                  value={field.value == null ? null : convertVolume(field.value, "gal", "bbl")}
                  onChange={(bbl) => field.onChange(bbl == null ? null : convertVolume(bbl, "bbl", "gal"))}
                  unitType="volume"
                  decimals={1}
                />
              )}
            />
          </div>
          <div>
            <Label htmlFor="sparge-water" className="text-xs">
              Sparge Water
            </Label>
            <Controller
              control={form.control}
              name="sparge_water_volume_gal"
              render={({ field }) => (
                <UnitInput
                  id="sparge-water"
                  value={field.value == null ? null : convertVolume(field.value, "gal", "bbl")}
                  onChange={(bbl) => field.onChange(bbl == null ? null : convertVolume(bbl, "bbl", "gal"))}
                  unitType="volume"
                  decimals={1}
                />
              )}
            />
          </div>
          <div>
            <Label htmlFor="preboil-vol" className="text-xs">
              Pre-Boil Volume
            </Label>
            <Controller
              control={form.control}
              name="preboil_volume_bbl"
              render={({ field }) => (
                <UnitInput
                  id="preboil-vol"
                  value={field.value}
                  onChange={field.onChange}
                  unitType="volume"
                  decimals={1}
                />
              )}
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
