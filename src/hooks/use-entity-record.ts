"use client";

/**
 * useEntityRecord
 *
 * Fetches a single entity record by id using the entity's view (when defined)
 * with a fallback to the base table. Selects `*` so the cached payload satisfies
 * every consumer that shares this query key — narrowing the projection here
 * would silently corrupt cache reads in `EntityDetailUnified` and other places
 * that rely on the full row.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { entityKeys } from "@/lib/query-keys";
import { dynamicFrom } from "@/services/types";
import { CACHE_DURATIONS } from "@/lib/constants";
import type { EntityConfig } from "@/types/entity";

export function useEntityRecord<T extends Record<string, unknown>>(
  entity: EntityConfig<T>,
  id: string | undefined,
  options: { enabled?: boolean } = {},
) {
  const supabase = createClient();
  const fetchTable = entity.viewTable || entity.table;
  const enabled = options.enabled !== false && !!id;

  return useQuery({
    queryKey: entityKeys.detail(fetchTable, id || ""),
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
    enabled,
    queryFn: async () => {
      const { data: row, error } = await dynamicFrom(supabase, fetchTable)
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return row as T;
    },
  });
}
