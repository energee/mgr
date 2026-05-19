"use client";

/**
 * RecipeAdditionsDisplay - Water chemistry and recipe additions display
 *
 * Sections:
 * 1. Water Chemistry -- calculates salt additions from source/target water profiles,
 *    shows ion concentration comparison, and provides "Apply to Recipe" button
 * 2. Applied Water Treatment -- shows water_salt/acid recipe_additions already saved
 * 3. Other Additions -- non-water additions (clarifiers, nutrients, etc.)
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { entityKeys, recipeKeys, catalogKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import {
  calculateAdditions,
  calculateResultingProfile,
  calculateSulfateChlorideRatio,
  formatRatio,
  getRatioDescription,
  mapSaltAdditionsToItems,
  toWaterProfile,
  SALT_ADDITIVE_MAP,
  WATER_IONS,
  type WaterProfile,
  type SaltAdditions,
} from "@/domain/water-chemistry";
import { useCatalog } from "@/hooks/use-catalog";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useVolumeUnit } from "@/hooks/use-unit-preferences";
import { convertVolume, formatVolume } from "@/domain/units";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FlaskConical, Pencil, Loader2, Check } from "lucide-react";
import { toast } from "sonner";

/** Water chemistry additive types */
const WATER_CHEMISTRY_TYPES = ["water_salt", "acid"];

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

/** Domain constants: brewing process timing labels (not entity status -- no stateMachine applies). */
const TIMING_LABELS: Record<string, string> = {
  mash: "Mash",
  sparge: "Sparge",
  boil: "Boil",
  whirlpool: "Whirlpool",
  fermentation: "Fermentation",
  packaging: "Packaging",
};

/** Domain constants: water chemistry target labels (not entity status). */
const TARGET_LABELS: Record<string, string> = {
  mash: "Mash Water",
  sparge: "Sparge Water",
  kettle: "Kettle",
};

/** Domain constants: additive type labels (not entity status -- no stateMachine applies). */
const TYPE_LABELS: Record<string, string> = {
  water_salt: "Water Salt",
  acid: "Acid",
  clarifier: "Clarifier",
  nutrient: "Nutrient",
  antifoam: "Antifoam",
  other: "Other",
};

/** Domain constants: additive type badge colors (not entity status). */
const TYPE_COLORS: Record<string, string> = {
  water_salt: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  acid: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  clarifier: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  nutrient: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  antifoam: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  other: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

type AdditionRow = {
  id: string;
  additive_id: string;
  amount: number;
  unit: string;
  timing: string;
  target: string | null;
  position: number | null;
  additive: {
    id: string;
    name: string;
    type: string;
    description: string | null;
  } | null;
}

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
    water_profile_id?: string | null;
    target_water_profile_id?: string | null;
    mash_water_volume_gal?: number | null;
    sparge_water_volume_gal?: number | null;
    batch_size_bbl?: number | null;
    volume_bbl?: number | null;
  };
}

export function RecipeAdditionsDisplay({ data }: RecipeAdditionsDisplayProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const recipeId = data.id;
  const sourceWaterProfileId = data.water_profile_id;
  const targetWaterProfileId = data.target_water_profile_id;

  // Fetch recipe-specific additions
  const { data: additions, isLoading: additionsLoading } = useQuery({
    queryKey: recipeKeys.additions(recipeId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_additions")
        .select(ADDITIONS_SELECT)
        .eq("recipe_id", recipeId!)
        .order("position", { ascending: true });

      if (error) throw error;
      return data as AdditionRow[];
    },
    enabled: !!recipeId,
  });

  // Fetch source water profile
  const { data: sourceWaterProfile } = useQuery({
    queryKey: entityKeys.detail("water_profiles", sourceWaterProfileId!),
    queryFn: async () => {
      const { data: row, error } = await supabase
        .from("water_profiles")
        .select("name, calcium_ppm, magnesium_ppm, sodium_ppm, sulfate_ppm, chloride_ppm, bicarbonate_ppm, ph")
        .eq("id", sourceWaterProfileId!)
        .single();
      if (error) throw error;
      return row;
    },
    enabled: !!sourceWaterProfileId,
  });

  // Fetch target water profile
  const { data: targetWaterProfile } = useQuery({
    queryKey: entityKeys.detail("water_profiles", targetWaterProfileId!),
    queryFn: async () => {
      const { data: row, error } = await supabase
        .from("water_profiles")
        .select("name, calcium_ppm, magnesium_ppm, sodium_ppm, sulfate_ppm, chloride_ppm, bicarbonate_ppm, ph")
        .eq("id", targetWaterProfileId!)
        .single();
      if (error) throw error;
      return row;
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

  // "Apply to Recipe" mutation: resolve additive IDs, insert recipe_additions rows
  const [applySuccess, setApplySuccess] = useState(false);
  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!calculatedAdditions || !recipeId) throw new Error("Missing data");

      const saltItems = mapSaltAdditionsToItems(calculatedAdditions, additiveCatalog);
      if (saltItems.length === 0) throw new Error("No salt additions to apply");

      // Delete existing water_salt/acid additions for this recipe
      const existingWaterIds = waterAdditions.map((a) => a.id);
      if (existingWaterIds.length > 0) {
        const { error: deleteError } = await supabase
          .from("recipe_additions")
          .delete()
          .in("id", existingWaterIds);
        if (deleteError) throw deleteError;
      }

      // Insert calculated salt additions
      const insertData = saltItems.map((item, index) => ({
        recipe_id: recipeId,
        additive_id: item.additive_id,
        amount: item.amount,
        unit: item.unit,
        timing: item.timing,
        target: item.target,
        position: index,
      }));

      const { error: insertError } = await supabase
        .from("recipe_additions")
        .insert(insertData);
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recipeKeys.additions(recipeId!) });
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
  const hasCalculatedAdditions = !!calculatedAdditions;
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
      {hasWaterProfiles && resultingProfile && targetProfile && (
        <WaterChemistrySummary
          source={sourceProfile!}
          target={targetProfile}
          targetName={targetWaterProfile?.name ?? undefined}
          resulting={resultingProfile}
        />
      )}

      {/* Calculated Salt Additions */}
      {hasCalculatedAdditions && (
        <CalculatedAdditionsSection
          additions={calculatedAdditions!}
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

/**
 * WaterChemistrySummary -- read-only table comparing source, target, and resulting
 * ion concentrations (ppm) plus the sulfate:chloride ratio.
 */
function WaterChemistrySummary({
  source,
  target,
  targetName,
  resulting,
}: {
  source: WaterProfile & { name?: string };
  target: WaterProfile;
  targetName?: string;
  resulting: WaterProfile;
}) {
  const ratio = calculateSulfateChlorideRatio(
    resulting.sulfate_ppm,
    resulting.chloride_ppm
  );
  const ratioDesc = getRatioDescription(ratio);

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        Water Chemistry
      </h4>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20" />
            {WATER_IONS.map((ion) => (
              <TableHead key={ion.key} className="text-center w-16">
                {ion.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="text-xs text-muted-foreground font-medium">
              Source
              {source.name && (
                <div className="text-[10px] font-normal truncate max-w-20">
                  {source.name}
                </div>
              )}
            </TableCell>
            {WATER_IONS.map((ion) => (
              <TableCell
                key={ion.key}
                className="text-center font-mono text-sm"
              >
                {Math.round(source[ion.key] ?? 0)}
              </TableCell>
            ))}
          </TableRow>
          <TableRow>
            <TableCell className="text-xs text-muted-foreground font-medium">
              Target
              {targetName && (
                <div className="text-[10px] font-normal truncate max-w-20">
                  {targetName}
                </div>
              )}
            </TableCell>
            {WATER_IONS.map((ion) => (
              <TableCell
                key={ion.key}
                className="text-center font-mono text-sm"
              >
                {Math.round(target[ion.key] ?? 0)}
              </TableCell>
            ))}
          </TableRow>
          <TableRow>
            <TableCell className="text-xs text-muted-foreground font-medium">
              Result
            </TableCell>
            {WATER_IONS.map((ion) => {
              const result = Math.round(resulting[ion.key]);
              const tgt = target[ion.key];
              const withinRange =
                tgt != null &&
                tgt > 0 &&
                Math.abs(result - tgt) / tgt <= 0.1;
              return (
                <TableCell
                  key={ion.key}
                  className={cn(
                    "text-center font-mono text-sm font-medium",
                    tgt != null &&
                      (withinRange
                        ? "text-green-600 dark:text-green-400"
                        : "text-amber-600 dark:text-amber-400")
                  )}
                >
                  {result}
                </TableCell>
              );
            })}
          </TableRow>
        </TableBody>
      </Table>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">SO&#x2084;:Cl Ratio:</span>
        <span className="font-mono font-medium">{formatRatio(ratio)}</span>
        <Badge variant="outline">{ratioDesc.label}</Badge>
      </div>
    </div>
  );
}

/** Calculated salt additions with "Apply to Recipe" button */
function CalculatedAdditionsSection({
  additions,
  onApply,
  isApplying,
  applySuccess,
  totalVolumeGal,
}: {
  additions: SaltAdditions;
  onApply: () => void;
  isApplying: boolean;
  applySuccess: boolean;
  totalVolumeGal: number;
}) {
  const nonZeroSalts = Object.entries(SALT_ADDITIVE_MAP).filter(
    ([key]) => additions[key as keyof SaltAdditions] > 0
  );

  const volumeUnit = useVolumeUnit();

  if (nonZeroSalts.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Calculated Salt Additions
          <span className="text-xs font-normal normal-case ml-2">
            ({formatVolume(convertVolume(totalVolumeGal, "gal", "bbl"), volumeUnit, 1)} total water)
          </span>
        </h4>
        <Button
          variant="outline"
          size="sm"
          onClick={onApply}
          disabled={isApplying}
          className="gap-1"
        >
          {isApplying ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : applySuccess ? (
            <Check className="h-3 w-3" />
          ) : null}
          {applySuccess ? "Applied" : "Apply to Recipe"}
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Salt</TableHead>
            <TableHead className="w-28 text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {nonZeroSalts.map(([key, name]) => (
            <TableRow key={key}>
              <TableCell className="font-medium">{name}</TableCell>
              <TableCell className="text-right font-mono">
                {additions[key as keyof SaltAdditions].toFixed(1)} g
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Other additions section -- clarifiers, nutrients, etc. */
function OtherAdditionsSection({
  additions,
}: {
  additions: AdditionRow[];
}) {
  const groupedByTiming = additions.reduce(
    (acc, addition) => {
      const timing = addition.timing;
      if (!acc[timing]) acc[timing] = [];
      acc[timing].push(addition);
      return acc;
    },
    {} as Record<string, AdditionRow[]>
  );

  return (
    <div>
      <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        Other Additions
      </h4>
      {Object.entries(groupedByTiming).map(([timing, items]) => (
        <div key={timing} className="mb-3">
          <div className="text-sm font-medium mb-1 flex items-center gap-2">
            <Badge variant="outline">{TIMING_LABELS[timing] || timing}</Badge>
            <span className="text-muted-foreground text-xs">
              ({items.length} {items.length === 1 ? "addition" : "additions"})
            </span>
          </div>
          <AdditionsTable additions={items} showTarget={timing === "mash" || timing === "sparge"} />
        </div>
      ))}
    </div>
  );
}

/** Shared table for displaying addition rows */
function AdditionsTable({
  additions,
  showTarget,
}: {
  additions: AdditionRow[];
  showTarget?: boolean;
}) {
  const hasTargets =
    showTarget ??
    additions.some((a) =>
      WATER_CHEMISTRY_TYPES.includes(a.additive?.type || "")
    );

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Additive</TableHead>
          <TableHead className="w-24">Type</TableHead>
          <TableHead className="w-28 text-right">Amount</TableHead>
          {hasTargets && <TableHead className="w-28">Target</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {additions.map((addition) => (
          <TableRow key={addition.id}>
            <TableCell>
              <div>
                <span className="font-medium">
                  {addition.additive?.name || "Unknown"}
                </span>
                {addition.additive?.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {addition.additive.description}
                  </p>
                )}
              </div>
            </TableCell>
            <TableCell>
              <Badge
                variant="secondary"
                className={TYPE_COLORS[addition.additive?.type || "other"]}
              >
                {TYPE_LABELS[addition.additive?.type || "other"]}
              </Badge>
            </TableCell>
            <TableCell className="text-right font-mono">
              {addition.amount} {addition.unit}
            </TableCell>
            {hasTargets && (
              <TableCell>
                {addition.target
                  ? TARGET_LABELS[addition.target] || addition.target
                  : "\u2014"}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
