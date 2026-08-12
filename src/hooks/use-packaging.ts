/**
 * Packaging hooks — shared between session-line-items-editor, packaging-day-view,
 * and the start-packaging / add-to-session dialogs.
 *
 * This module is a thin React-Query wrapper only. The logic it used to own now
 * lives in two React-free modules:
 * - `src/domain/packaging-planning.ts` — planned-quantity suggestion, fill-volume
 *   map building, packaging-readiness sort, batch/brand row mapping.
 * - `src/services/packaging-service.ts` — the Supabase reads.
 *
 * The pure functions and their types are re-exported here for existing consumers
 * (and their tests); new non-React callers should import them from the domain or
 * service module directly.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { usePackagingFormats } from "@/hooks/use-catalog";
import { entityKeys, packagingKeys } from "@/lib/query-keys";
import { buildFillVolumeMap } from "@/domain/packaging-planning";
import {
  fetchBatchesForBrand,
  fetchOpenPackagingSessions,
  fetchPackagableBatches,
  fetchSellingFormatFillVolumes,
} from "@/services/packaging-service";

export type {
  BatchOption,
  FillVolumeRow,
  PackagableBatchOption,
  RawPackagableBatchRow,
} from "@/domain/packaging-planning";

export { computeUnitFillVolumeBbl } from "@/domain/consumption-planning";
export {
  mapPackagableBatches,
  suggestPlannedQuantity,
} from "@/domain/packaging-planning";

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

/**
 * Map of selling_format id → per-unit fill volume (BBL).
 * Used to prefill planned packaging quantities.
 */
export function useSellingFormatFillVolumes(): Map<string, number> {
  const supabase = createClient();
  const { data } = useQuery({
    queryKey: entityKeys.list("selling_formats", { select: "fill-volume" }),
    queryFn: () => fetchSellingFormatFillVolumes(supabase),
  });
  return useMemo(() => buildFillVolumeMap(data ?? []), [data]);
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
    queryFn: () => fetchOpenPackagingSessions(supabase),
    enabled,
  });
}

/**
 * All packagable batches whose recipe has a brand. Powers the batch-first
 * quick-add row: picking a batch auto-derives the line-item brand_id.
 */
export function usePackagableBatches() {
  const supabase = createClient();
  return useQuery({
    queryKey: entityKeys.list("batches_with_brew_info", {
      select: "packagable-with-brand",
    }),
    queryFn: () => fetchPackagableBatches(supabase),
  });
}

/**
 * Batches that belong to a given brand (via recipe FK).
 * Used by BatchCell on existing line-item rows (brand already fixed);
 * the quick-add row is batch-first via usePackagableBatches instead.
 */
export function useBatchesForBrand(brandId: string | null) {
  const supabase = createClient();
  return useQuery({
    queryKey: packagingKeys.batchesForBrand(brandId ?? ""),
    queryFn: () => fetchBatchesForBrand(supabase, brandId),
    enabled: !!brandId,
  });
}
