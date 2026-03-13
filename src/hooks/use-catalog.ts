"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { brandKeys, packagingFormatKeys, entityKeys } from "@/lib/query-keys";
import { dynamicFrom } from "@/services/types";

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

      const { data, error } = await query;
      if (error) throw error;
      return data as T[];
    },
  });
}

type IdNamePair = { id: string; name: string };

/** Fetch all brands (id, name) - brands table has no is_active column */
export function useBrands(): UseQueryResult<IdNamePair[]> {
  const supabase = createClient();

  return useQuery({
    queryKey: brandKeys.all(),
    queryFn: async (): Promise<IdNamePair[]> => {
      const { data, error } = await supabase
        .from("brands")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data;
    },
  });
}

/** Fetch active keg owners (id, name) */
export function useKegOwners(): UseQueryResult<IdNamePair[]> {
  return useCatalog<IdNamePair>(entityKeys.all("keg_owners"), "keg_owners", "id, name", ["position", "name"]);
}

/**
 * A packaging format from the packaging_formats view (selling_formats + containers).
 * Used by the pricing matrix and format selectors.
 */
export type PackagingFormat = {
  id: string;
  name: string;
  container_type: string;
  container_name: string;
  unit_count: number;
}

/** Fetch packaging formats (view over selling_formats + containers) */
export function usePackagingFormats(): UseQueryResult<PackagingFormat[]> {
  const supabase = createClient();

  return useQuery({
    queryKey: packagingFormatKeys.all(),
    queryFn: async (): Promise<PackagingFormat[]> => {
      const { data, error } = await supabase
        .from("packaging_formats")
        .select("id, name, container_type, container_name, unit_count")
        .eq("is_active", true)
        .order("container_type")
        .order("name");
      if (error) throw error;
      return data as PackagingFormat[];
    },
  });
}

/** Check if a selling format ID refers to a keg container type */
export function isKegFormat(
  formatId: string | null,
  formats: PackagingFormat[] | undefined
): boolean {
  if (!formatId || !formats) return false;
  return formats.some((f) => f.id === formatId && f.container_type === "keg");
}
