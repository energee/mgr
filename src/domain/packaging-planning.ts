/**
 * Packaging planning — pure math and mapping behind the packaging session
 * editors (quick-add row, packaging day view, start-packaging / add-to-session
 * dialogs).
 *
 * React-free by contract: every function here is callable from a route
 * handler, an AI tool, or a test with no React import. The Supabase reads that
 * feed these functions live in `src/services/packaging-service.ts`; the hooks
 * in `src/hooks/use-packaging.ts` are thin React-Query wrappers over both.
 *
 * Per-unit fill-volume math (`computeUnitFillVolumeBbl`) stays in
 * `src/domain/consumption-planning.ts` — it is shared with BOM consumption and
 * the TTB summaries — and is re-exported through the map builder below.
 */

import { computeUnitFillVolumeBbl } from "@/domain/consumption-planning";

/** A batch as offered in packaging pickers. */
export type BatchOption = {
  id: string;
  batch_code: string;
  name: string;
  status: string;
  volume_bbl: number | null;
  current_vessel_name: string | null;
};

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

/** Row shape for the selling_formats → containers fill-volume join. */
export type FillVolumeRow = {
  id: string;
  unit_count: number | null;
  container: { volume_bbl: number | null; volume_oz?: number | null } | null;
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

/** Comparator ordering batches by packaging readiness; unknown statuses last. */
export function comparePackagingReadiness(
  a: { status: string | null },
  b: { status: string | null }
): number {
  return (
    (STATUS_SORT_ORDER[a.status ?? ""] ?? 99) -
    (STATUS_SORT_ORDER[b.status ?? ""] ?? 99)
  );
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
export function buildFillVolumeMap(
  rows: readonly FillVolumeRow[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const vol = computeUnitFillVolumeBbl(row);
    if (vol != null) map.set(row.id, vol);
  }
  return map;
}

/**
 * Flattens the recipe/brand embed, drops rows without a derivable brand
 * (session_line_items.brand_id is NOT NULL, so a batch without a brand can't
 * seed a line item), and sorts by packaging readiness.
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
    .sort(comparePackagingReadiness);
}
