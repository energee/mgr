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
 * Uses a single query with an inner join on recipes to filter server-side,
 * avoiding a waterfall of two sequential queries.
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
          "id, batch_number, name, status, volume_bbl, current_vessel_name, recipe_id, recipes!inner(brand_id)"
        )
        .in("status", ["planned", "fermenting", "conditioning", "packaging"])
        .eq("recipes.brand_id" as string, brandId);
      if (error) throw error;

      return ((data ?? []) as unknown as BatchOption[]).sort(
        (a, b) =>
          (STATUS_SORT_ORDER[a.status ?? ""] ?? 99) -
          (STATUS_SORT_ORDER[b.status ?? ""] ?? 99)
      );
    },
    enabled: !!brandId,
  });
}
