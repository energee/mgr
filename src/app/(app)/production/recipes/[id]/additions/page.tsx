"use client";

/**
 * Recipe Additions Page
 *
 * Manage clarifiers, nutrients, and other non-water-chemistry additions for a recipe.
 * Water salt additions are calculated from source/target water profiles on the recipe detail page.
 */

import { use, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { AdditionsEditor, type AdditionItem } from "@/components/domain/additions-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { recipeKeys } from "@/lib/query-keys";

/** Additive types managed via water chemistry calculations, excluded from this editor */
const WATER_CHEMISTRY_TYPES = ["water_salt", "acid"];

export default function RecipeAdditionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [items, setItems] = useState<AdditionItem[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch recipe details
  const { data: recipe, isLoading: recipeLoading } = useQuery({
    queryKey: recipeKeys.detail(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipes")
        .select("id, name, target_water_profile_id")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Fetch existing additions with additive details
  const { data: additions, isLoading: additionsLoading } = useQuery({
    queryKey: recipeKeys.additions(id),
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
          additives (
            id,
            name,
            type,
            description,
            typical_amount,
            typical_unit
          )
        `)
        .eq("recipe_id", id)
        .order("position", { ascending: true });
      if (error) throw error;
      return data as unknown as (AdditionItem & { additives: AdditionItem["additive"] })[];
    },
  });

  // Filter to non-water-chemistry additions only
  const nonWaterAdditions = useMemo(
    () =>
      (additions || []).filter(
        (a) => !WATER_CHEMISTRY_TYPES.includes(a.additives?.type || "")
      ),
    [additions]
  );

  // Sync fetched data to local editable state (React recommended pattern:
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders)
  const [prevAdditions, setPrevAdditions] = useState(nonWaterAdditions);
  if (nonWaterAdditions !== prevAdditions) {
    setPrevAdditions(nonWaterAdditions);
    setItems(
      nonWaterAdditions.map((a) => ({
        id: a.id,
        additive_id: a.additive_id,
        amount: a.amount,
        unit: a.unit,
        timing: a.timing,
        target: a.target || undefined,
        position: a.position,
        additive: a.additives,
      }))
    );
    setHasChanges(false);
  }

  // Handle items change
  const handleChange = (newItems: AdditionItem[]) => {
    setItems(newItems);
    setHasChanges(true);
  };

  // Save mutation — only touches non-water-chemistry items
  const saveMutation = useMutation({
    mutationFn: async () => {
      // Get IDs of existing non-water-chemistry additions to delete
      const existingNonWaterIds = (additions || [])
        .filter((a) => !WATER_CHEMISTRY_TYPES.includes(a.additives?.type || ""))
        .map((a) => a.id)
        .filter(Boolean) as string[];

      // Delete existing non-water additions for this recipe
      if (existingNonWaterIds.length > 0) {
        const { error: deleteError } = await supabase
          .from("recipe_additions")
          .delete()
          .in("id", existingNonWaterIds);
        if (deleteError) throw deleteError;
      }

      // Insert new additions
      if (items.length > 0) {
        const insertData = items.map((item, index) => ({
          recipe_id: id,
          additive_id: item.additive_id,
          amount: item.amount,
          unit: item.unit,
          timing: item.timing,
          target: item.target || null,
          position: index,
        }));

        const { error: insertError } = await supabase
          .from("recipe_additions")
          .insert(insertData);
        if (insertError) throw insertError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recipeKeys.additions(id) });
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(id) });
      setHasChanges(false);
      toast.success("Additions saved");
    },
    onError: (error) => {
      toast.error("Failed to save: " + error.message);
    },
  });

  if (recipeLoading) {
    return (
      <div className="container max-w-4xl py-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="container max-w-4xl py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href={`/production/recipes/${id}`}>
            <Button variant="ghost" size="icon" aria-label="Back to recipe">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{recipe?.name}</h1>
            <p className="text-muted-foreground">
              Clarifiers, Nutrients & Other Additions
            </p>
          </div>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!hasChanges || saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Changes
          </Button>
        </div>

        {/* Additions Editor */}
        <Card>
          <CardHeader>
            <CardTitle>Recipe Additions</CardTitle>
            <CardDescription>
              Add clarifiers, nutrients, and other additions to this recipe.
              Water salt additions are calculated automatically from source and target water profiles.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {additionsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <AdditionsEditor
                items={items}
                onChange={handleChange}
                disabled={saveMutation.isPending}
                excludeTypes={WATER_CHEMISTRY_TYPES}
              />
            )}
          </CardContent>
        </Card>

        {/* Help text */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Addition Types</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              <strong>Clarifiers:</strong> Whirlfloc, Irish Moss, gelatin for clarity.
            </p>
            <p>
              <strong>Nutrients:</strong> Yeast nutrients, Fermaid-O, etc. for healthy fermentation.
            </p>
            <p>
              <strong>Other:</strong> Antifoam, enzymes, or other process additions.
            </p>
            <p className="text-xs border-t pt-2 mt-2">
              Water salts (Gypsum, CaCl&#x2082;, etc.) and acids are calculated from source and target{" "}
              <Link
                href="/settings/water-profiles"
                className="underline hover:text-foreground"
              >
                water profiles
              </Link>
              {" "}set on the recipe.
            </p>
          </CardContent>
        </Card>
      </div>
    </ErrorBoundary>
  );
}
