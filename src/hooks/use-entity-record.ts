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
import { detailQueryOptions } from "@/components/universal/detail-query-options";
import { CACHE_DURATIONS } from "@/lib/constants";
import type { EntityConfig } from "@/types/entity";

export function useEntityRecord<T extends Record<string, unknown>>(
  entity: EntityConfig<T>,
  id: string | undefined,
  options: { enabled?: boolean } = {},
) {
  const supabase = createClient();
  const enabled = options.enabled !== false && !!id;

  // Shared factory so the key + select stay identical to a server component's
  // detail prefetch (sitewide loading pattern) — the client hydrates without a
  // second skeleton or a key mismatch.
  return useQuery({
    ...detailQueryOptions<T>(supabase, entity, id || ""),
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
    enabled,
  });
}
