"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { brandKeys, packageTypeKeys } from "@/lib/query-keys";

/**
 * Generic hook for fetching active catalog items from a Supabase table.
 */
export function useCatalog<T>(
  queryKey: readonly unknown[],
  table: string,
  select: string,
  orderBy: string[] = ["name"]
) {
  const supabase = createClient();

  return useQuery({
    queryKey,
    queryFn: async () => {
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

/** Fetch active brands (id, name) */
export function useBrands() {
  return useCatalog<{ id: string; name: string }>(
    brandKeys.all(),
    "brands",
    "id, name"
  );
}

/** Fetch active package types (id, name) */
export function usePackageTypes() {
  return useCatalog<{ id: string; name: string }>(
    packageTypeKeys.all(),
    "package_types",
    "id, name"
  );
}
