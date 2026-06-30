/**
 * Packaging hooks — shared between session-line-items-editor, packaging-day-view,
 * and the start-packaging / add-to-session dialogs. Also exports the pure
 * planned-quantity suggestion math (batch volume ÷ per-unit fill volume) and
 * the batch-first usePackagableBatches list (batch → recipe → brand join)
 * behind the quick-add row's primary batch selector.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { unwrap } from "@/lib/supabase/query-helpers";
import { usePackagingFormats } from "@/hooks/use-catalog";
import { entityKeys, packagingKeys } from "@/lib/query-keys";

export type BatchOption = {
  id: string;
  batch_code: string;
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
 * Returns a memoized Set of selling_format IDs that represent keg containers.
 * Eliminates duplicate kegFormatIds memos across packaging components.
 */
export function useKegFormatIds(): Set<string> {
  const { data: packagingFormats } = usePackagingFormats();
  return useMemo(
    () =>
      new Set(
        packagingFormats
          ?.filter((f) => f.container_type === "keg")
          .map((f) => f.id)
      ),
    [packagingFormats]
  );
}

// =============================================================================
// Planned-quantity suggestion (batch volume ÷ per-unit fill volume)
// =============================================================================

/** Row shape for the selling_formats → containers fill-volume join. */
export type FillVolumeRow = {
  id: string;
  unit_count: number | null;
  container: { volume_bbl: number | null } | null;
};

/**
 * Per-selling-unit fill volume in BBL: containers.volume_bbl × unit_count.
 * Same math as packaging-completion-review's implied-loss calculation — the
 * authoritative source, used instead of the packaging_formats view's
 * volume_bbl (whose checked-in definition is stale). Returns null when the
 * container volume is missing or non-positive.
 */
export function computeUnitFillVolumeBbl(
  row: Pick<FillVolumeRow, "unit_count" | "container">
): number | null {
  const containerBbl = row.container?.volume_bbl;
  if (containerBbl == null || containerBbl <= 0) return null;
  return containerBbl * (row.unit_count ?? 1);
}

/**
 * Suggested planned quantity: floor(batch volume ÷ per-unit fill volume).
 * Returns null when either volume is unknown/non-positive or when the batch
 * doesn't fill a single unit (a 0 suggestion is never useful). The small
 * epsilon guards against float division landing just under a whole number.
 */
export function suggestPlannedQuantity(
  batchVolumeBbl: number | null | undefined,
  unitVolumeBbl: number | null | undefined
): number | null {
  if (batchVolumeBbl == null || unitVolumeBbl == null) return null;
  if (batchVolumeBbl <= 0 || unitVolumeBbl <= 0) return null;
  const qty = Math.floor(batchVolumeBbl / unitVolumeBbl + 1e-9);
  return qty >= 1 ? qty : null;
}

/**
 * Map of selling_format id → per-unit fill volume (BBL), built from the
 * selling_formats → containers join. Formats without a usable container
 * volume are omitted. Used to prefill planned packaging quantities.
 */
export function useSellingFormatFillVolumes(): Map<string, number> {
  const supabase = createClient();
  const { data } = useQuery({
    queryKey: entityKeys.list("selling_formats", { select: "fill-volume" }),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("selling_formats")
        .select("id, unit_count, container:containers(volume_bbl)");
      if (error) throw error;
      // Supabase infers the containers join as an array; it is many-to-one
      return (data ?? []) as unknown as FillVolumeRow[];
    },
  });
  return useMemo(() => {
    const map = new Map<string, number>();
    for (const row of data ?? []) {
      const vol = computeUnitFillVolumeBbl(row);
      if (vol != null) map.set(row.id, vol);
    }
    return map;
  }, [data]);
}

/**
 * Open (planned/in_progress) packaging sessions, newest first.
 * Shares its query key with add-to-packaging-session-dialog so both surfaces
 * read the same cache entry.
 */
export function useOpenPackagingSessions(enabled: boolean) {
  const supabase = createClient();
  return useQuery({
    queryKey: entityKeys.list("packaging_sessions", { status: ["planned", "in_progress"] }),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("packaging_sessions")
        .select("id, session_date, status")
        .in("status", ["planned", "in_progress"])
        .order("session_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled,
  });
}

/** BatchOption enriched with the brand derived from the batch's recipe. */
export type PackagableBatchOption = BatchOption & {
  brand_id: string;
  brand_name: string | null;
};

/** Raw row shape of the batches → recipes!inner → brands embed. */
export type RawPackagableBatchRow = BatchOption & {
  recipes: {
    brand_id: string | null;
    brands: { name: string } | null;
  } | null;
};

/**
 * Pure mapping for usePackagableBatches: flattens the recipe/brand embed,
 * drops rows without a derivable brand (session_line_items.brand_id is
 * NOT NULL, so a batch without a brand can't seed a line item), and sorts
 * by packaging readiness (STATUS_SORT_ORDER).
 */
export function mapPackagableBatches(
  rows: RawPackagableBatchRow[]
): PackagableBatchOption[] {
  return rows
    .map<PackagableBatchOption>((b) => ({
      id: b.id,
      batch_code: b.batch_code,
      name: b.name,
      status: b.status,
      volume_bbl: b.volume_bbl,
      current_vessel_name: b.current_vessel_name,
      brand_id: b.recipes?.brand_id ?? "",
      brand_name: b.recipes?.brands?.name ?? null,
    }))
    .filter((b) => !!b.brand_id)
    .sort(
      (a, b) =>
        (STATUS_SORT_ORDER[a.status ?? ""] ?? 99) -
        (STATUS_SORT_ORDER[b.status ?? ""] ?? 99)
    );
}

/**
 * All packagable batches whose recipe has a brand, with that brand embedded
 * via the recipes → brands join. Powers the batch-first quick-add row:
 * picking a batch auto-derives the (NOT NULL) line-item brand_id. The inner
 * join on recipes plus the brand_id null filter excludes brandless batches —
 * the same population the brand-first useBatchesForBrand flow could reach.
 */
export function usePackagableBatches() {
  const supabase = createClient();
  return useQuery({
    queryKey: entityKeys.list("batches_with_brew_info", {
      select: "packagable-with-brand",
    }),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("batches_with_brew_info")
        .select(
          "id, batch_code, name, status, volume_bbl, current_vessel_name, recipe_id, recipes!inner(brand_id, brands(name))"
        )
        .in("status", ["planned", "fermenting", "conditioning", "packaging"])
        .not("recipes.brand_id", "is", null);
      if (error) throw error;

      // Supabase infers embedded relations loosely on views; the join shape
      // is many-to-one (batch → recipe → brand).
      return mapPackagableBatches(
        (data ?? []) as unknown as RawPackagableBatchRow[]
      );
    },
  });
}

/**
 * Fetch batches that belong to a given brand (via recipe FK).
 * Uses a single query with an inner join on recipes to filter server-side,
 * avoiding a waterfall of two sequential queries.
 * Used by BatchCell on existing line-item rows (brand already fixed);
 * the quick-add row is batch-first via usePackagableBatches instead.
 */
export function useBatchesForBrand(brandId: string | null) {
  const supabase = createClient();
  return useQuery({
    queryKey: packagingKeys.batchesForBrand(brandId ?? ""),
    queryFn: async () => {
      if (!brandId) return [];
      const data = await unwrap(
        supabase
          .from("batches_with_brew_info")
          .select(
            "id, batch_code, name, status, volume_bbl, current_vessel_name, recipe_id, recipes!inner(brand_id)"
          )
          .in("status", ["planned", "fermenting", "conditioning", "packaging"])
          .eq("recipes.brand_id" as string, brandId)
      );

      return ((data ?? []) as unknown as BatchOption[]).sort(
        (a, b) =>
          (STATUS_SORT_ORDER[a.status ?? ""] ?? 99) -
          (STATUS_SORT_ORDER[b.status ?? ""] ?? 99)
      );
    },
    enabled: !!brandId,
  });
}
