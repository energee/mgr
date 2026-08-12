"use client";

/**
 * RecipeAdditionsDisplay - Water chemistry and recipe additions container
 *
 * Owns data fetching (recipe additions, water profiles, additive catalog),
 * the salt-calculation memos, and the "Apply to Recipe" mutation. Rendering
 * is delegated to three feature components:
 * 1. Water Chemistry -- water-chemistry-summary.tsx (ion comparison table +
 *    calculated salt additions with "Apply to Recipe")
 * 2. Applied Water Treatment -- additions-table.tsx over the saved
 *    water_salt/acid recipe_additions
 * 3. Other Additions -- other-additions-section.tsx (clarifiers, nutrients,
 *    etc., grouped by timing)
 *
 * Salt math lives in src/domain/water-chemistry.ts; label/color lookups in
 * addition-labels.ts.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { entityKeys, recipeKeys, catalogKeys } from "@/lib/query-keys";
import {
  calculateAdditions,
  calculateResultingProfile,
  mapSaltAdditionsToItems,
  toWaterProfile,
  type WaterProfile,
  type SaltAdditions,
} from "@/domain/water-chemistry";
import { useCatalog } from "@/hooks/use-catalog";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FlaskConical, Pencil } from "lucide-react";
import { toast } from "sonner";
import { unwrap } from "@/lib/supabase/query-helpers";
import { replaceRecipeAdditions } from "@/services/recipe-additions-service";
import {
  WaterChemistrySummary,
  CalculatedAdditionsSection,
} from "./water-chemistry-summary";
import { AdditionsTable } from "./additions-table";
import { OtherAdditionsSection } from "./other-additions-section";
import { WATER_CHEMISTRY_TYPES, type AdditionRow } from "./addition-labels";

/** Shared Supabase select fragment for recipe_additions with nested additive */
const ADDITIONS_SELECT = `
  id,
  additive_id,
  amount,
  unit,
  timing,
  target,
  position,
  additive:additives (
    id,
    name,
    type,
    description
  )
` as const;

type CatalogItem = {
  id: string;
  name: string;
  type: string;
}

/** Gallons per barrel */
const GAL_PER_BBL = 31.0;

type RecipeAdditionsDisplayProps = {
  data: {
    id: string | null;
    version?: number;
    water_profile_id?: string | null;
    target_water_profile_id?: string | null;
    mash_water_volume_gal?: number | null;
    sparge_water_volume_gal?: number | null;
    batch_size_bbl?: number | null;
    volume_bbl?: number | null;
  };
  /** Keep an enclosing recipe editor's optimistic-lock version in sync. */
  onVersionCommitted?: (version: number) => void;
}

export function RecipeAdditionsDisplay({
  data,
  onVersionCommitted,
}: RecipeAdditionsDisplayProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const recipeId = data.id;
  const sourceWaterProfileId = data.water_profile_id;
  const targetWaterProfileId = data.target_water_profile_id;

  // The estimates view used by the universal detail page does not expose
  // recipes.version. Keep this projection on its own key so it cannot replace
  // the full recipe detail cache with a partial row.
  // Keep the recipe version query warm so recipeKeys.version stays populated for
  // other consumers; the apply mutation itself reads the version fresh from the
  // DB rather than trusting this cache (see applyMutation below).
  useQuery({
    queryKey: recipeKeys.version(recipeId!),
    queryFn: async () => {
      return await unwrap(
        supabase
          .from("recipes")
          .select("version")
          .eq("id", recipeId!)
          .single()
      ) as { version: number };
    },
    initialData: typeof data.version === "number" ? { version: data.version } : undefined,
    enabled: !!recipeId,
  });

  // Fetch recipe-specific additions
  const { data: additions, isLoading: additionsLoading } = useQuery({
    queryKey: recipeKeys.additions(recipeId!),
    queryFn: async () => {
      return await unwrap(
        supabase
          .from("recipe_additions")
          .select(ADDITIONS_SELECT)
          .eq("recipe_id", recipeId!)
          .order("position", { ascending: true })
      ) as AdditionRow[];
    },
    enabled: !!recipeId,
  });

  // Fetch source water profile
  const { data: sourceWaterProfile } = useQuery({
    queryKey: entityKeys.detail("water_profiles", sourceWaterProfileId!),
    queryFn: async () => {
      return await unwrap(
        supabase
          .from("water_profiles")
          .select("name, calcium_ppm, magnesium_ppm, sodium_ppm, sulfate_ppm, chloride_ppm, bicarbonate_ppm, ph")
          .eq("id", sourceWaterProfileId!)
          .single()
      ) as { name: string | null; calcium_ppm: number | null; magnesium_ppm: number | null; sodium_ppm: number | null; sulfate_ppm: number | null; chloride_ppm: number | null; bicarbonate_ppm: number | null; ph: number | null } | null;
    },
    enabled: !!sourceWaterProfileId,
  });

  // Fetch target water profile
  const { data: targetWaterProfile } = useQuery({
    queryKey: entityKeys.detail("water_profiles", targetWaterProfileId!),
    queryFn: async () => {
      return await unwrap(
        supabase
          .from("water_profiles")
          .select("name, calcium_ppm, magnesium_ppm, sodium_ppm, sulfate_ppm, chloride_ppm, bicarbonate_ppm, ph")
          .eq("id", targetWaterProfileId!)
          .single()
      ) as { name: string | null; calcium_ppm: number | null; magnesium_ppm: number | null; sodium_ppm: number | null; sulfate_ppm: number | null; chloride_ppm: number | null; bicarbonate_ppm: number | null; ph: number | null } | null;
    },
    enabled: !!targetWaterProfileId,
  });

  // Fetch additives catalog for resolving salt names to IDs
  const { data: additiveCatalog = [] } = useCatalog<CatalogItem>(
    catalogKeys.additives(),
    "additives",
    "id, name, type",
    ["type", "name"]
  );

  // Calculate total water volume for salt addition scaling.
  // Prefer explicit mash+sparge volumes; fall back to batch_size or recipe volume in BBL.
  const explicitWaterGal =
    (data.mash_water_volume_gal ?? 0) + (data.sparge_water_volume_gal ?? 0);
  const totalVolumeGal =
    explicitWaterGal > 0
      ? explicitWaterGal
      : ((data.batch_size_bbl ?? data.volume_bbl ?? 0) * GAL_PER_BBL);

  // Calculate additions from source -> target delta
  const calculatedAdditions = useMemo((): SaltAdditions | null => {
    if (!sourceWaterProfile || !targetWaterProfile || totalVolumeGal <= 0) return null;
    return calculateAdditions(
      toWaterProfile(sourceWaterProfile),
      toWaterProfile(targetWaterProfile),
      totalVolumeGal
    );
  }, [sourceWaterProfile, targetWaterProfile, totalVolumeGal]);

  // Calculate resulting profile after additions
  const resultingProfile = useMemo((): WaterProfile | null => {
    if (!sourceWaterProfile || !calculatedAdditions || totalVolumeGal <= 0) return null;
    return calculateResultingProfile(
      toWaterProfile(sourceWaterProfile),
      calculatedAdditions,
      totalVolumeGal
    );
  }, [sourceWaterProfile, calculatedAdditions, totalVolumeGal]);

  // Split additions into water chemistry and other
  const waterAdditions = useMemo(
    () => (additions || []).filter((a) => WATER_CHEMISTRY_TYPES.includes(a.additive?.type || "")),
    [additions]
  );
  const otherAdditions = useMemo(
    () => (additions || []).filter((a) => !WATER_CHEMISTRY_TYPES.includes(a.additive?.type || "")),
    [additions]
  );

  // "Apply to Recipe" mutation: replace only water chemistry in one transaction.
  const [applySuccess, setApplySuccess] = useState(false);
  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!calculatedAdditions || !recipeId) throw new Error("Missing data");

      const saltItems = mapSaltAdditionsToItems(calculatedAdditions, additiveCatalog);
      if (saltItems.length === 0) throw new Error("No salt additions to apply");

      // Read the recipe version FRESH from the database immediately before the
      // atomic RPC. Do NOT trust the cached recipeKeys.version query: its
      // initialData is only honored on first render and nothing invalidates the
      // key when the version is bumped out-of-band (another recipe section save,
      // the additions editor page, etc.), so the cached value goes stale and
      // triggers spurious PT409 optimistic-lock conflicts. Reading latest then
      // writing under the RPC's FOR UPDATE lock still catches genuine concurrent
      // human edits (the RPC re-checks version under lock), it only removes the
      // false positives from benign prior version bumps.
      const { version: freshVersion } = await unwrap(
        supabase.from("recipes").select("version").eq("id", recipeId).single()
      ) as { version: number };
      if (typeof freshVersion !== "number") {
        throw new Error("Recipe version is not loaded");
      }

      return replaceRecipeAdditions(supabase, {
        recipeId,
        expectedVersion: freshVersion,
        scope: "water_chemistry",
        items: saltItems,
      });
    },
    onSuccess: async ({ version }) => {
      queryClient.setQueryData(recipeKeys.version(recipeId!), { version });
      onVersionCommitted?.(version);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: recipeKeys.additions(recipeId!) }),
        queryClient.invalidateQueries({
          queryKey: recipeKeys.detail(recipeId!),
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: entityKeys.detail("recipes_with_estimates", recipeId!),
          exact: true,
        }),
      ]);
      setApplySuccess(true);
      setTimeout(() => setApplySuccess(false), 2000);
      toast.success("Salt additions applied to recipe");
    },
    onError: (error) => {
      toast.error("Failed to apply: " + error.message);
    },
  });

  if (!recipeId) {
    return (
      <div className="text-center text-muted-foreground py-6">
        <FlaskConical className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p>Recipe not saved yet</p>
      </div>
    );
  }

  if (additionsLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  const hasWaterProfiles = !!sourceWaterProfile && !!targetWaterProfile;
  const hasWaterAdditions = waterAdditions.length > 0;
  const hasOtherAdditions = otherAdditions.length > 0;
  const hasNothing = !hasWaterProfiles && !hasWaterAdditions && !hasOtherAdditions;

  if (hasNothing) {
    return (
      <div className="text-center text-muted-foreground py-6">
        <FlaskConical className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p>No additions defined</p>
        <p className="text-sm mt-1">
          Set source and target water profiles on the recipe to calculate salt
          additions, or add clarifiers and nutrients via the additions editor
        </p>
        <Button variant="outline" size="sm" className="mt-4" asChild>
          <Link href={`/production/recipes/${recipeId}/additions`}>
            <Pencil className="h-4 w-4 mr-2" />
            Edit Additions
          </Link>
        </Button>
      </div>
    );
  }

  const sourceProfile = sourceWaterProfile
    ? { ...toWaterProfile(sourceWaterProfile), name: sourceWaterProfile.name ?? undefined }
    : null;

  const targetProfile = targetWaterProfile
    ? toWaterProfile(targetWaterProfile)
    : null;

  return (
    <div className="space-y-6">
      {/* Water Chemistry Section */}
      {sourceProfile && targetProfile && resultingProfile && (
        <WaterChemistrySummary
          source={sourceProfile}
          target={targetProfile}
          targetName={targetWaterProfile?.name ?? undefined}
          resulting={resultingProfile}
        />
      )}

      {/* Calculated Salt Additions */}
      {calculatedAdditions && (
        <CalculatedAdditionsSection
          additions={calculatedAdditions}
          onApply={() => applyMutation.mutate()}
          isApplying={applyMutation.isPending}
          applySuccess={applySuccess}
          totalVolumeGal={totalVolumeGal}
        />
      )}

      {/* No profiles set message */}
      {!hasWaterProfiles && (
        <div>
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Water Chemistry
          </h4>
          <p className="text-sm text-muted-foreground">
            Set both a source and target{" "}
            <Link
              href="/settings/water-profiles"
              className="underline hover:text-foreground"
            >
              water profile
            </Link>
            {" "}on this recipe to calculate salt additions.
          </p>
        </div>
      )}

      {/* Applied Water Treatment Section */}
      {hasWaterAdditions && (
        <div>
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Applied Water Treatment
          </h4>
          <AdditionsTable additions={waterAdditions} />
        </div>
      )}

      {/* Other Additions Section */}
      {hasOtherAdditions && (
        <OtherAdditionsSection additions={otherAdditions} />
      )}

      {/* Edit link for other additions */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/production/recipes/${recipeId}/additions`}>
            <Pencil className="h-4 w-4 mr-2" />
            Edit Additions
          </Link>
        </Button>
      </div>
    </div>
  );
}
