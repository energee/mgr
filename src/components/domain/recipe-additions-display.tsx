"use client";

/**
 * RecipeAdditionsDisplay - Display component for recipe additions
 *
 * Split into two sections:
 * 1. Water Treatment — read-only display of linked addition profile's items (with link to profile),
 *    including a water chemistry summary showing source/target/resulting ion concentrations
 *    when the recipe has a source water profile and the addition profile has target values.
 * 2. Other Additions — recipe-specific non-water additions (clarifiers, nutrients, etc.)
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { entityKeys, recipeKeys, waterAdditionProfileKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import {
  calculateResultingProfile,
  calculateSulfateChlorideRatio,
  getRatioDescription,
  SALT_ADDITIVE_MAP,
  type WaterProfile,
  type SaltAdditions,
} from "@/lib/water-chemistry";
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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FlaskConical, Pencil, ExternalLink } from "lucide-react";

// Water chemistry additive types (managed via profiles)
const WATER_CHEMISTRY_TYPES = ["water_salt", "acid"];

// Timing labels
const TIMING_LABELS: Record<string, string> = {
  mash: "Mash",
  sparge: "Sparge",
  boil: "Boil",
  whirlpool: "Whirlpool",
  fermentation: "Fermentation",
  packaging: "Packaging",
};

// Target labels (for water salts)
const TARGET_LABELS: Record<string, string> = {
  mash: "Mash Water",
  sparge: "Sparge Water",
  kettle: "Kettle",
};

// Additive type labels
const TYPE_LABELS: Record<string, string> = {
  water_salt: "Water Salt",
  acid: "Acid",
  clarifier: "Clarifier",
  nutrient: "Nutrient",
  antifoam: "Antifoam",
  other: "Other",
};

// Type colors for badges
const TYPE_COLORS: Record<string, string> = {
  water_salt: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  acid: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  clarifier: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  nutrient: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  antifoam: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  other: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

interface AdditionRow {
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

interface RecipeAdditionsDisplayProps {
  data: {
    id: string | null;
    water_addition_profile_id?: string | null;
    water_profile_id?: string | null;
    mash_water_volume_gal?: number | null;
    sparge_water_volume_gal?: number | null;
  };
}

export function RecipeAdditionsDisplay({ data }: RecipeAdditionsDisplayProps) {
  const supabase = createClient();
  const recipeId = data.id;
  const profileId = data.water_addition_profile_id;

  // Fetch recipe-specific additions
  const { data: additions, isLoading: additionsLoading } = useQuery({
    queryKey: recipeKeys.additions(recipeId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_additions")
        .select(`
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
        `)
        .eq("recipe_id", recipeId!)
        .order("position", { ascending: true });

      if (error) throw error;
      return data as AdditionRow[];
    },
    enabled: !!recipeId,
  });

  // Fetch profile details (name + target water chemistry values) when a profile is linked
  const { data: profile } = useQuery({
    queryKey: waterAdditionProfileKeys.detail(profileId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("water_addition_profiles")
        .select("id, name, water_profile_id, target_calcium_ppm, target_magnesium_ppm, target_sodium_ppm, target_sulfate_ppm, target_chloride_ppm, target_bicarbonate_ppm, target_ph")
        .eq("id", profileId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!profileId,
  });

  // Fetch profile items when a profile is linked
  const { data: profileItems, isLoading: profileItemsLoading } = useQuery({
    queryKey: waterAdditionProfileKeys.items(profileId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_additions")
        .select(`
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
        `)
        .eq("profile_id", profileId!)
        .order("position", { ascending: true });

      if (error) throw error;
      return data as AdditionRow[];
    },
    enabled: !!profileId,
  });

  // Fetch the recipe's source water profile for chemistry calculations
  const sourceWaterProfileId = data.water_profile_id;

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

  // Reverse-map additive names to SaltAdditions keys for chemistry calculations
  const ADDITIVE_TO_SALT_KEY = useMemo(() => {
    const map: Record<string, keyof SaltAdditions> = {};
    for (const [key, name] of Object.entries(SALT_ADDITIVE_MAP)) {
      map[name.toLowerCase()] = key as keyof SaltAdditions;
    }
    return map;
  }, []);

  // Build SaltAdditions from the profile's addition items
  const saltAdditionsFromItems = useMemo((): SaltAdditions | null => {
    if (!profileItems || profileItems.length === 0) return null;
    const additions: SaltAdditions = {
      gypsum_g: 0,
      calcium_chloride_g: 0,
      epsom_salt_g: 0,
      baking_soda_g: 0,
      chalk_g: 0,
      table_salt_g: 0,
      magnesium_chloride_g: 0,
    };
    let hasAnySalt = false;
    for (const item of profileItems) {
      const name = item.additive?.name?.toLowerCase();
      if (name && ADDITIVE_TO_SALT_KEY[name] && item.unit === "g") {
        additions[ADDITIVE_TO_SALT_KEY[name]] = item.amount;
        hasAnySalt = true;
      }
    }
    return hasAnySalt ? additions : null;
  }, [profileItems, ADDITIVE_TO_SALT_KEY]);

  // Calculate the resulting water profile after salt additions, scaled to recipe volume
  const totalVolumeGal =
    (data.mash_water_volume_gal ?? 0) + (data.sparge_water_volume_gal ?? 0);

  const resultingProfile = useMemo((): WaterProfile | null => {
    if (!sourceWaterProfile || !saltAdditionsFromItems || totalVolumeGal <= 0)
      return null;
    const source: WaterProfile = {
      calcium_ppm: sourceWaterProfile.calcium_ppm ?? 0,
      magnesium_ppm: sourceWaterProfile.magnesium_ppm ?? 0,
      sodium_ppm: sourceWaterProfile.sodium_ppm ?? 0,
      sulfate_ppm: sourceWaterProfile.sulfate_ppm ?? 0,
      chloride_ppm: sourceWaterProfile.chloride_ppm ?? 0,
      bicarbonate_ppm: sourceWaterProfile.bicarbonate_ppm ?? 0,
    };
    return calculateResultingProfile(source, saltAdditionsFromItems, totalVolumeGal);
  }, [sourceWaterProfile, saltAdditionsFromItems, totalVolumeGal]);

  // Check whether the addition profile has any target ppm values set
  const hasProfileTargets =
    profile &&
    (profile.target_calcium_ppm != null ||
      profile.target_sulfate_ppm != null ||
      profile.target_chloride_ppm != null);

  // Filter recipe additions to non-water-chemistry types only
  const otherAdditions = useMemo(
    () =>
      (additions || []).filter(
        (a) => !WATER_CHEMISTRY_TYPES.includes(a.additive?.type || "")
      ),
    [additions]
  );

  const isLoading = additionsLoading || (!!profileId && profileItemsLoading);

  // Handle null recipe ID (after hooks)
  if (!recipeId) {
    return (
      <div className="text-center text-muted-foreground py-6">
        <FlaskConical className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p>Recipe not saved yet</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  const hasProfileItems = profileItems && profileItems.length > 0;
  const hasOtherAdditions = otherAdditions.length > 0;
  const hasNothing = !hasProfileItems && !hasOtherAdditions && !profileId;

  if (hasNothing) {
    return (
      <div className="text-center text-muted-foreground py-6">
        <FlaskConical className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p>No additions defined</p>
        <p className="text-sm mt-1">
          Select a water addition profile on the recipe, or add clarifiers and
          nutrients via the additions editor
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

  return (
    <div className="space-y-6">
      {/* Water Treatment Section */}
      <WaterTreatmentSection
        profileId={profileId}
        profileName={profile?.name}
        profileItems={profileItems || []}
        sourceWaterProfile={
          sourceWaterProfile
            ? {
                ...(({
                  calcium_ppm: sourceWaterProfile.calcium_ppm ?? 0,
                  magnesium_ppm: sourceWaterProfile.magnesium_ppm ?? 0,
                  sodium_ppm: sourceWaterProfile.sodium_ppm ?? 0,
                  sulfate_ppm: sourceWaterProfile.sulfate_ppm ?? 0,
                  chloride_ppm: sourceWaterProfile.chloride_ppm ?? 0,
                  bicarbonate_ppm: sourceWaterProfile.bicarbonate_ppm ?? 0,
                }) satisfies WaterProfile),
                name: sourceWaterProfile.name ?? undefined,
              }
            : null
        }
        profileTargets={
          hasProfileTargets
            ? {
                calcium_ppm: profile!.target_calcium_ppm,
                magnesium_ppm: profile!.target_magnesium_ppm,
                sodium_ppm: profile!.target_sodium_ppm,
                sulfate_ppm: profile!.target_sulfate_ppm,
                chloride_ppm: profile!.target_chloride_ppm,
                bicarbonate_ppm: profile!.target_bicarbonate_ppm,
              }
            : null
        }
        resultingProfile={resultingProfile}
      />

      {/* Other Additions Section */}
      {hasOtherAdditions && (
        <OtherAdditionsSection
          additions={otherAdditions}
        />
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

/** Target ppm values from an addition profile */
interface ProfileTargets {
  calcium_ppm: number | null;
  magnesium_ppm: number | null;
  sodium_ppm: number | null;
  sulfate_ppm: number | null;
  chloride_ppm: number | null;
  bicarbonate_ppm: number | null;
}

/** Water treatment section — shows linked profile items, chemistry summary, or empty state */
function WaterTreatmentSection({
  profileId,
  profileName,
  profileItems,
  sourceWaterProfile,
  profileTargets,
  resultingProfile,
}: {
  profileId: string | null | undefined;
  profileName: string | undefined;
  profileItems: AdditionRow[];
  sourceWaterProfile?: (WaterProfile & { name?: string }) | null;
  profileTargets?: ProfileTargets | null;
  resultingProfile?: WaterProfile | null;
}) {
  if (!profileId) {
    return (
      <div>
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Water Treatment
        </h4>
        <p className="text-sm text-muted-foreground">
          No water addition profile selected. Choose one in the Fermentation
          section above, or{" "}
          <Link
            href="/settings/water-profiles/additions"
            className="underline hover:text-foreground"
          >
            manage profiles
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Water Treatment
        </h4>
        <Link
          href={`/settings/water-profiles/additions/${profileId}`}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          {profileName || "Profile"}
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      {sourceWaterProfile && profileTargets && resultingProfile && (
        <WaterChemistrySummary
          source={sourceWaterProfile}
          target={profileTargets}
          resulting={resultingProfile}
        />
      )}
      {profileItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Profile has no additions defined yet.{" "}
          <Link
            href={`/settings/water-profiles/additions/${profileId}`}
            className="underline hover:text-foreground"
          >
            Add items
          </Link>
        </p>
      ) : (
        <AdditionsTable additions={profileItems} />
      )}
    </div>
  );
}

/**
 * WaterChemistrySummary — read-only table comparing source, target, and resulting
 * ion concentrations (ppm) plus the sulfate:chloride ratio.
 * Values within 10% of target are highlighted green; those outside are amber.
 */
function WaterChemistrySummary({
  source,
  target,
  resulting,
}: {
  source: WaterProfile & { name?: string };
  target: ProfileTargets;
  resulting: WaterProfile;
}) {
  const ions = [
    { key: "calcium_ppm", label: "Ca\u00B2\u207A" },
    { key: "magnesium_ppm", label: "Mg\u00B2\u207A" },
    { key: "sodium_ppm", label: "Na\u207A" },
    { key: "sulfate_ppm", label: "SO\u2084\u00B2\u207B" },
    { key: "chloride_ppm", label: "Cl\u207B" },
    { key: "bicarbonate_ppm", label: "HCO\u2083\u207B" },
  ] as const;

  const ratio = calculateSulfateChlorideRatio(
    resulting.sulfate_ppm,
    resulting.chloride_ppm
  );
  const ratioDesc = getRatioDescription(ratio);

  return (
    <div className="space-y-2 mb-4">
      <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        Water Chemistry
      </h4>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20" />
            {ions.map((ion) => (
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
            </TableCell>
            {ions.map((ion) => (
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
            </TableCell>
            {ions.map((ion) => (
              <TableCell
                key={ion.key}
                className="text-center font-mono text-sm"
              >
                {target[ion.key] != null
                  ? Math.round(target[ion.key]!)
                  : "\u2014"}
              </TableCell>
            ))}
          </TableRow>
          <TableRow>
            <TableCell className="text-xs text-muted-foreground font-medium">
              Result
            </TableCell>
            {ions.map((ion) => {
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
        <span className="font-mono font-medium">{ratio}</span>
        <Badge variant="outline">{ratioDesc.label}</Badge>
      </div>
    </div>
  );
}

/** Other additions section — clarifiers, nutrients, etc. */
function OtherAdditionsSection({
  additions,
}: {
  additions: AdditionRow[];
}) {
  // Group by timing
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
  // Auto-detect if any items need target column
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
                  : "—"}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
