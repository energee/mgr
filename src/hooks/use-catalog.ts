"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { unwrap } from "@/lib/supabase/query-helpers";
import { brandKeys, packagingFormatKeys, entityKeys } from "@/lib/query-keys";
import { dynamicFrom } from "@/services/types";
import { formatSmartDecimal } from "@/lib/format";

// Smallest plausible per-unit container volume (oz). When a packaging format's
// volume_oz divided by unit_count is below this, treat volume_oz as already
// per-unit; at or above, treat it as a rolled-up case total and divide.
const MIN_PER_UNIT_OZ = 8;

/**
 * Generic hook for fetching active catalog items from a Supabase table.
 * Uses dynamic table name, so Supabase client requires `as any` cast
 * (table name is a runtime string, not a known literal from the generated types).
 */
const DEFAULT_ORDER_BY = ["name"];

export function useCatalog<T>(
  queryKey: readonly unknown[],
  table: string,
  select: string,
  orderBy: string[] = DEFAULT_ORDER_BY
): UseQueryResult<T[]> {
  const supabase = createClient();

  return useQuery({
    queryKey,
    queryFn: async (): Promise<T[]> => {
      let query = dynamicFrom(supabase, table)
        .select(select)
        .eq("is_active", true);

      for (const field of orderBy) {
        query = query.order(field);
      }

      return (await unwrap(query)) as T[];
    },
  });
}

type IdNamePair = { id: string; name: string };

/** Fetch all brands (id, name) - brands table has no is_active column */
export function useBrands(): UseQueryResult<IdNamePair[]> {
  const supabase = createClient();

  return useQuery({
    queryKey: brandKeys.all(),
    queryFn: async (): Promise<IdNamePair[]> =>
      unwrap(supabase.from("brands").select("id, name").order("name")),
  });
}

/** Fetch active keg owners (id, name) */
export function useKegOwners(): UseQueryResult<IdNamePair[]> {
  return useCatalog<IdNamePair>(entityKeys.all("keg_owners"), "keg_owners", "id, name", ["position", "name"]);
}

/**
 * A packaging format from the packaging_formats view (selling_formats + containers).
 * Used by the pricing matrix and format selectors.
 *
 * `volume_oz` is set for package formats (cans, bottles); null for kegs.
 * `volume_bbl` is set for keg formats; null for packages.
 */
export type PackagingFormat = {
  id: string;
  name: string;
  container_type: string;
  container_name: string;
  unit_count: number;
  volume_oz: number | null;
  volume_bbl: number | null;
}

/**
 * Returns a concise volume label for a packaging format showing per-unit
 * volume × count:
 * - Package: "{per-unit oz}oz x {unit_count}" (e.g., "16oz x 24")
 * - Keg: "{volume_bbl} BBL" (e.g., "1/2 BBL")
 * - Unknown: null
 *
 * `containers.volume_oz` is inconsistent in the data: some rows are per-unit
 * (e.g. 11.25oz Glass with unit_count=12) and some are rolled-up case totals
 * (e.g. "384oz Can" with unit_count=24, representing 24×16oz cans). The
 * MIN_PER_UNIT_OZ threshold disambiguates: if dividing yields a value at or
 * above the smallest plausible single-container size, the row is rolled-up.
 * TODO: normalize containers.volume_oz to per-unit and drop this heuristic.
 */
export function formatVolumeLabel(format: Pick<PackagingFormat, "container_type" | "volume_oz" | "volume_bbl" | "unit_count">): string | null {
  if (format.container_type !== "keg" && format.volume_oz != null) {
    const { unit_count: count, volume_oz } = format;
    const isRolledUp = count > 1 && volume_oz / count >= MIN_PER_UNIT_OZ;
    const perUnit = isRolledUp ? volume_oz / count : volume_oz;
    return `${formatSmartDecimal(perUnit)}oz x ${count}`;
  }
  if (format.container_type === "keg" && format.volume_bbl != null) {
    return `${format.volume_bbl} BBL`;
  }
  return null;
}

/** Fetch packaging formats (view over selling_formats + containers) */
export function usePackagingFormats(): UseQueryResult<PackagingFormat[]> {
  const supabase = createClient();

  return useQuery({
    queryKey: packagingFormatKeys.all(),
    queryFn: async (): Promise<PackagingFormat[]> =>
      (await unwrap(
        supabase
          .from("packaging_formats")
          .select("id, name, container_type, container_name, unit_count, volume_oz, volume_bbl")
          .eq("is_active", true)
          .order("container_type")
          .order("name"),
      )) as PackagingFormat[],
  });
}

