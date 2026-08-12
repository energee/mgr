/**
 * Packaging service — the Supabase reads behind the packaging session editors
 * (quick-add row, packaging day view, start-packaging / add-to-session dialogs).
 *
 * React-free by contract: these functions take a `SupabaseClient` and are
 * callable from a route handler, an AI tool, or a test with no React import.
 * The pure mapping/sorting they apply lives in `src/domain/packaging-planning.ts`;
 * `src/hooks/use-packaging.ts` is a thin React-Query wrapper over both.
 *
 * These readers **throw** (via `unwrap`) rather than returning `ServiceResult`,
 * unlike the write-oriented services in this directory. That is deliberate and
 * behavior-preserving: their only callers are React-Query `queryFn`s, which
 * surface a thrown `PostgrestError` as query error state. A ServiceResult here
 * would need to be re-thrown at every call site to keep that behavior.
 *
 * Sessions consume packaging materials through `selling_format_materials`
 * (BOM) — there is deliberately no direct session↔material table, so nothing
 * here reads one.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { unwrap } from "@/lib/supabase/query-helpers";
import {
  comparePackagingReadiness,
  mapPackagableBatches,
  type BatchOption,
  type FillVolumeRow,
  type PackagableBatchOption,
  type RawPackagableBatchRow,
} from "@/domain/packaging-planning";

type Client = SupabaseClient<Database>;

/** An open (planned/in_progress) packaging session, as listed for pickers. */
export type OpenPackagingSession = {
  id: string;
  session_date: string;
  status: string;
};

const PACKAGABLE_BATCH_STATUSES = [
  "planned",
  "fermenting",
  "conditioning",
  "packaging",
];

/**
 * selling_formats → containers rows carrying the per-unit fill volume.
 * Feeds `buildFillVolumeMap`, which drops formats without a usable volume.
 */
export async function fetchSellingFormatFillVolumes(
  supabase: Client
): Promise<FillVolumeRow[]> {
  const data = await unwrap(
    supabase
      .from("selling_formats")
      .select("id, unit_count, container:containers(volume_bbl, volume_oz)")
  );
  // Supabase infers the containers join as an array; it is many-to-one
  return (data ?? []) as unknown as FillVolumeRow[];
}

/** Open (planned/in_progress) packaging sessions, newest first. */
export async function fetchOpenPackagingSessions(
  supabase: Client
): Promise<OpenPackagingSession[]> {
  const data = await unwrap(
    supabase
      .from("packaging_sessions")
      .select("id, session_date, status")
      .in("status", ["planned", "in_progress"])
      .order("session_date", { ascending: false })
  );
  return (data ?? []) as unknown as OpenPackagingSession[];
}

/**
 * All packagable batches whose recipe has a brand, with that brand embedded
 * via the recipes → brands join. Powers the batch-first quick-add row: picking
 * a batch auto-derives the (NOT NULL) line-item brand_id. The inner join on
 * recipes plus the brand_id null filter excludes brandless batches — the same
 * population the brand-first `fetchBatchesForBrand` flow could reach.
 */
export async function fetchPackagableBatches(
  supabase: Client
): Promise<PackagableBatchOption[]> {
  const data = await unwrap(
    supabase
      .from("batches_with_brew_info")
      .select(
        "id, batch_code, name, status, volume_bbl, current_vessel_name, recipe_id, recipes!inner(brand_id, brands(name))"
      )
      .in("status", PACKAGABLE_BATCH_STATUSES)
      .not("recipes.brand_id", "is", null)
  );

  // Supabase infers embedded relations loosely on views; the join shape
  // is many-to-one (batch → recipe → brand).
  return mapPackagableBatches((data ?? []) as unknown as RawPackagableBatchRow[]);
}

/**
 * Packagable batches belonging to a given brand (via recipe FK), sorted by
 * packaging readiness. A single query with an inner join on recipes filters
 * server-side, avoiding a waterfall of two sequential queries.
 */
export async function fetchBatchesForBrand(
  supabase: Client,
  brandId: string | null
): Promise<BatchOption[]> {
  if (!brandId) return [];
  const data = await unwrap(
    supabase
      .from("batches_with_brew_info")
      .select(
        "id, batch_code, name, status, volume_bbl, current_vessel_name, recipe_id, recipes!inner(brand_id)"
      )
      .in("status", PACKAGABLE_BATCH_STATUSES)
      .eq("recipes.brand_id" as string, brandId)
  );

  return ((data ?? []) as unknown as BatchOption[]).sort(
    comparePackagingReadiness
  );
}
