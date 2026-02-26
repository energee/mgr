"use client";

/**
 * Hook to fetch dynamic filter options from Supabase.
 *
 * Handles both legacy `fetchOptions` and new `dynamicOptions` patterns.
 * Returns a stable map of field name → options array. Only triggers
 * re-renders when the actual option data changes (deep comparison).
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { EntityFilterDef } from "@/types/entity";

export type DynamicFilterOptions = Record<
  string,
  { value: string; label: string }[]
>;

/**
 * Shallow-compare two DynamicFilterOptions maps.
 * Returns true if they have the same keys with the same option arrays
 * (compared by value+label of each entry).
 */
function optionsEqual(
  a: DynamicFilterOptions,
  b: DynamicFilterOptions
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    const arrA = a[key];
    const arrB = b[key];
    if (!arrB || arrA.length !== arrB.length) return false;
    for (let i = 0; i < arrA.length; i++) {
      if (arrA[i].value !== arrB[i].value || arrA[i].label !== arrB[i].label) {
        return false;
      }
    }
  }
  return true;
}

export function useDynamicFilterOptions(
  listFilters: EntityFilterDef[] | undefined,
  entityName: string
): DynamicFilterOptions {
  const supabase = useMemo(() => createClient(), []);
  const [dynamicFilterOptions, setDynamicFilterOptions] =
    useState<DynamicFilterOptions>({});
  const prevOptionsRef = useRef<DynamicFilterOptions>({});

  // Stable setter that only updates state when data actually changes
  const setOptionsIfChanged = useCallback(
    (newOptions: DynamicFilterOptions) => {
      if (!optionsEqual(prevOptionsRef.current, newOptions)) {
        prevOptionsRef.current = newOptions;
        setDynamicFilterOptions(newOptions);
      }
    },
    []
  );

  // Reset when navigating between entities
  useEffect(() => {
    prevOptionsRef.current = {};
    setDynamicFilterOptions({});
  }, [entityName]);

  // Fetch dynamic filter options
  useEffect(() => {
    const fetchDynamicOptions = async () => {
      const filtersWithDynamicOptions =
        listFilters?.filter((f) => f.fetchOptions || f.dynamicOptions) || [];
      if (filtersWithDynamicOptions.length === 0) return;

      const results = await Promise.all(
        filtersWithDynamicOptions.map(async (filter) => {
          try {
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

              // Apply filter if specified
              if (queryFilter) {
                Object.entries(queryFilter).forEach(([key, value]) => {
                  query = query.eq(
                    key,
                    value as string | number | boolean
                  );
                });
              }

              // Apply ordering if specified
              if (orderBy) {
                const orderFields = orderBy.split(",").map((f) => f.trim());
                orderFields.forEach((field) => {
                  query = query.order(field, { ascending: true });
                });
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
          } catch (error) {
            console.error(
              `Failed to fetch options for filter ${filter.field}:`,
              error
            );
            return { field: filter.field, options: [] };
          }
        })
      );

      const optionsMap = results.reduce(
        (acc, { field, options }) => ({ ...acc, [field]: options }),
        {} as DynamicFilterOptions
      );

      setOptionsIfChanged(optionsMap);
    };

    fetchDynamicOptions();
  }, [listFilters, entityName, supabase, setOptionsIfChanged]);

  return dynamicFilterOptions;
}
