"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { brandKeys, packageTypeKeys } from "@/lib/query-keys";

/**
 * Generic hook for fetching active catalog items from a Supabase table.
 * Note: Uses `as any` cast because table name is dynamic, not a literal type.
 */
export function useCatalog<T>(
  queryKey: readonly unknown[],
  table: string,
  select: string,
  orderBy: string[] = ["name"]
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
