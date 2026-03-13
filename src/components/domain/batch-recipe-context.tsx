"use client";

/**
 * BatchRecipeContext - Show the recipe spec this batch was brewed from
 *
 * Displays recipe estimates (OG, FG, ABV, IBU) from recipes_with_estimates,
 * with optional variant badge if the batch targets a specific recipe variant.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";
import { recipeKeys, recipeVariantKeys } from "@/lib/query-keys";

// =============================================================================
// Types
// =============================================================================

type RecipeEstimates = {
  id: string;
  name: string | null;
  style_name: string | null;
  est_og: number | null;
  est_fg: number | null;
  est_abv: number | null;
  est_ibu: number | null;
  est_srm: number | null;
}

type RecipeVariant = {
  id: string;
  name: string | null;
  description: string | null;
}

type BatchRecipeContextProps = {
  data: {
    id: string;
    recipe_id?: string | null;
    recipe_variant_id?: string | null;
    [key: string]: unknown;
  };
}

// =============================================================================
// Component
// =============================================================================

export function BatchRecipeContext({ data }: BatchRecipeContextProps) {
  const supabase = createClient();
  const recipeId = data.recipe_id;
  const variantId = data.recipe_variant_id;

  // Fetch recipe estimates
  const { data: recipe, isLoading: recipeLoading } = useQuery({
    queryKey: recipeKeys.estimates(recipeId!),
    queryFn: async () => {
      const { data: result, error } = await supabase
        .from("recipes_with_estimates")
        .select("id, name, style_name, est_og, est_fg, est_abv, est_ibu, est_srm")
        .eq("id", recipeId!)
        .single();

      if (error) throw error;
      return result as unknown as RecipeEstimates;
    },
    enabled: !!recipeId,
  });

  // Fetch variant if linked
  const { data: variant } = useQuery({
    queryKey: recipeVariantKeys.detail(variantId!),
    queryFn: async () => {
      const { data: result, error } = await supabase
        .from("recipe_variants")
        .select("id, name, description")
        .eq("id", variantId!)
        .single();

      if (error) throw error;
      return result as RecipeVariant;
    },
    enabled: !!variantId,
  });

  if (!recipeId) {
    return (
      <div className="text-sm text-muted-foreground">No recipe linked</div>
    );
  }

  if (recipeLoading) {
    return null;
  }

  if (!recipe) {
    return (
      <div className="text-sm text-muted-foreground">
        Unable to load recipe data
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Recipe name and link */}
      <div className="flex items-center justify-between">
        <Link
          href={`/production/recipes/${recipeId}`}
          className="text-base font-medium hover:underline inline-flex items-center gap-1.5"
        >
          {recipe.name}
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
        {recipe.style_name && (
          <Badge variant="outline">{recipe.style_name}</Badge>
        )}
      </div>

      {/* Variant badge */}
      {variant && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Variant: {variant.name}</Badge>
          {variant.description && (
            <span className="text-sm text-muted-foreground">
              {variant.description}
            </span>
          )}
        </div>
      )}

      {/* Estimates grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {recipe.est_og != null && (
          <div>
            <div className="text-sm font-medium text-muted-foreground">
              Est OG
            </div>
            <div className="text-lg">{recipe.est_og.toFixed(1)}&deg;P</div>
          </div>
        )}
        {recipe.est_fg != null && (
          <div>
            <div className="text-sm font-medium text-muted-foreground">
              Est FG
            </div>
            <div className="text-lg">{recipe.est_fg.toFixed(1)}&deg;P</div>
          </div>
        )}
        {recipe.est_abv != null && (
          <div>
            <div className="text-sm font-medium text-muted-foreground">
              Est ABV
            </div>
            <div className="text-lg">{recipe.est_abv.toFixed(1)}%</div>
          </div>
        )}
        {recipe.est_ibu != null && (
          <div>
            <div className="text-sm font-medium text-muted-foreground">
              Est IBU
            </div>
            <div className="text-lg">{Math.round(recipe.est_ibu)}</div>
          </div>
        )}
        {recipe.est_srm != null && (
          <div>
            <div className="text-sm font-medium text-muted-foreground">
              Est SRM
            </div>
            <div className="text-lg">{recipe.est_srm.toFixed(1)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
