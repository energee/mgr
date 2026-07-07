"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { unwrap } from "@/lib/supabase/query-helpers";
import { brandKeys, packagingFormatKeys, entityKeys } from "@/lib/query-keys";
import { dynamicFrom } from "@/services/types";
import { formatSmartDecimal } from "@/lib/format";

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
 * `containers.volume_oz` is per-unit — the volume of ONE container, never a
 * rolled-up case/pack total (canonical semantic since migration 00202, which
 * normalized the historical rolled-up rows), so the raw value is displayed
 * directly.
 */
export function formatVolumeLabel(format: Pick<PackagingFormat, "container_type" | "volume_oz" | "volume_bbl" | "unit_count">): string | null {
  if (format.container_type !== "keg" && format.volume_oz != null) {
    return `${formatSmartDecimal(format.volume_oz)}oz x ${format.unit_count}`;
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

