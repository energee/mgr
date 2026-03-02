"use client";

/**
 * Hook to fetch dynamic filter options from Supabase.
 *
 * Uses React Query (useQueries) for proper caching and error handling.
 * Handles both legacy `fetchOptions` and new `dynamicOptions` patterns.
 * Returns a map of field name -> options array.
 */

import { useMemo } from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicOptionsKeys } from "@/lib/query-keys";
import { CACHE_DURATIONS } from "@/lib/constants";
import type { EntityFilterDef } from "@/types/entity";

export type DynamicFilterOptions = Record<
  string,
  { value: string; label: string }[]
>;

export function useDynamicFilterOptions(
  listFilters: EntityFilterDef[] | undefined,
  entityName: string
): DynamicFilterOptions {
  const supabase = useMemo(() => createClient(), []);

  const filtersWithDynamic = useMemo(
    () => (listFilters ?? []).filter((f) => f.fetchOptions || f.dynamicOptions),
    [listFilters]
  );

  type FilterResult = { field: string; options: { value: string; label: string }[] };

  return useQueries({
    queries: filtersWithDynamic.map((filter) => ({
      queryKey: dynamicOptionsKeys.field(entityName, filter.field),
      staleTime: CACHE_DURATIONS.STATIC_DATA,
      queryFn: async (): Promise<FilterResult> => {
        // Handle legacy fetchOptions
        if (filter.fetchOptions) {
          const options = await filter.fetchOptions();
          return { field: filter.field, options };
        }

        // Handle dynamicOptions (fetch from database)
        if (filter.dynamicOptions) {
          const {
            table,
            valueField,
            labelField,
            filter: queryFilter,
            orderBy,
          } = filter.dynamicOptions;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let query = (supabase as any)
            .from(table)
            .select(`${valueField}, ${labelField}`);

          if (queryFilter) {
            for (const [key, value] of Object.entries(queryFilter)) {
              query = query.eq(key, value as string | number | boolean);
            }
          }

          if (orderBy) {
            for (const field of orderBy.split(",").map((f) => f.trim())) {
              query = query.order(field, { ascending: true });
            }
          } else {
            query = query.order(labelField, { ascending: true });
          }

          const { data, error } = await query;
          if (error) throw error;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const options = (data || []).map((row: any) => ({
            value: String(row[valueField]),
            label: String(row[labelField]),
          }));
          return { field: filter.field, options };
        }

        return { field: filter.field, options: [] };
      },
    })),
    combine: (results: UseQueryResult<FilterResult>[]) => {
      const optionsMap: DynamicFilterOptions = {};
      for (const q of results) {
        if (q.data) {
          optionsMap[q.data.field] = q.data.options;
        }
      }
      return optionsMap;
    },
  });
}
