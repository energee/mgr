"use client";

/**
 * RecipeAdditionsDisplay - Display component for recipe additions
 *
 * Split into two sections:
 * 1. Water Treatment — read-only display of linked addition profile's items (with link to profile)
 * 2. Other Additions — recipe-specific non-water additions (clarifiers, nutrients, etc.)
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys, waterAdditionProfileKeys } from "@/lib/query-keys";
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

  // Fetch profile name when a profile is linked
  const { data: profile } = useQuery({
    queryKey: waterAdditionProfileKeys.detail(profileId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("water_addition_profiles")
        .select("id, name")
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

/** Water treatment section — shows linked profile items or empty state */
function WaterTreatmentSection({
  profileId,
  profileName,
  profileItems,
}: {
  profileId: string | null | undefined;
  profileName: string | undefined;
  profileItems: AdditionRow[];
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
