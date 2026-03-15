/**
 * Packaging hooks — shared between session-line-items-editor and packaging-day-view.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { packagingKeys } from "@/lib/query-keys";

export type BatchOption = {
  id: string;
  batch_number: string;
  name: string;
  status: string;
  volume_bbl: number | null;
  current_vessel_name: string | null;
};

/**
 * Domain constants: packaging-context batch sort priority.
 * Batches closest to packaging readiness sort first. This is a domain-specific
 * ordering for the packaging UI, not a status label/color map (DEC-007 N/A).
 */
const STATUS_SORT_ORDER: Record<string, number> = {
  conditioning: 1,
  packaging: 2,
  fermenting: 3,
  planned: 4,
};

/**
 * Fetch batches that belong to a given brand (via recipe FK).
 * Filters to active statuses and sorts by packaging readiness.
 */
export function useBatchesForBrand(brandId: string | null) {
  const supabase = createClient();
  return useQuery({
    queryKey: packagingKeys.batchesForBrand(brandId ?? ""),
    queryFn: async () => {
      if (!brandId) return [];
      const { data, error } = await supabase
        .from("batches_with_brew_info")
        .select(
          "id, batch_number, name, status, volume_bbl, current_vessel_name, recipe_id"
        )
        .in("status", ["planned", "fermenting", "conditioning", "packaging"]);
      if (error) throw error;

      const recipeIds = [
        ...new Set(
          (data ?? [])
            .map((b) => b.recipe_id)
            .filter((id): id is string => id != null)
        ),
      ];
      if (recipeIds.length === 0) return [];

      const { data: recipes, error: recipeError } = await supabase
        .from("recipes")
        .select("id, brand_id")
        .in("id", recipeIds)
        .eq("brand_id", brandId);
      if (recipeError) throw recipeError;

      const validRecipeIds = new Set((recipes ?? []).map((r) => r.id));
      return (data ?? [])
        .filter((b) => b.recipe_id && validRecipeIds.has(b.recipe_id))
        .sort(
          (a, b) =>
            (STATUS_SORT_ORDER[a.status ?? ""] ?? 99) -
            (STATUS_SORT_ORDER[b.status ?? ""] ?? 99)
        ) as BatchOption[];
    },
    enabled: !!brandId,
  });
}
