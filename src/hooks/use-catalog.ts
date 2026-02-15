"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { brandKeys, packageTypeKeys, packagingFormatKeys, entityKeys } from "@/lib/query-keys";

/**
 * Generic hook for fetching active catalog items from a Supabase table.
 * Note: Uses `as any` cast because table name is dynamic, not a literal type.
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = (supabase as any)
        .from(table)
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

/** Fetch active package types (id, name) */
export function usePackageTypes(): UseQueryResult<IdNamePair[]> {
  return useCatalog<IdNamePair>(packageTypeKeys.all(), "package_types", "id, name");
}

/**
 * A packaging format from the union view (package_types + keg_types).
 * `format_source` discriminates which table the ID came from.
 */
export interface PackagingFormat {
  id: string;
  name: string;
  format_source: "package_type" | "keg_type";
  container_type: string;
}

/** Fetch active keg owners (id, name) */
export function useKegOwners(): UseQueryResult<IdNamePair[]> {
  return useCatalog<IdNamePair>(entityKeys.all("keg_owners"), "keg_owners", "id, name", ["position", "name"]);
}

/** Fetch packaging formats (union of non-keg package_types + keg_types) */
export function usePackagingFormats(): UseQueryResult<PackagingFormat[]> {
  const supabase = createClient();

  return useQuery({
    queryKey: packagingFormatKeys.all(),
    queryFn: async (): Promise<PackagingFormat[]> => {
      const { data, error } = await supabase
        .from("packaging_formats")
        .select("id, name, format_source, container_type")
        .eq("is_active", true)
        .order("format_source")
        .order("name");
      if (error) throw error;
      return data as PackagingFormat[];
    },
  });
}
