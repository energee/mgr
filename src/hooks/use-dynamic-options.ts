/**
 * useDynamicOptions - Hook for fetching dynamic select/relation options
 *
 * Handles both `dynamicOptions` (arbitrary table query) and `relation` type
 * fields (entity registry lookup). Returns a map of fieldName -> options[].
 *
 * Works with both EntityFieldDef and UnifiedFieldDef since they share the
 * same shape for the properties this hook cares about:
 *   - name: string
 *   - dynamicOptions?: { table, valueField, labelField, filter?, orderBy? }
 *   - type?: string (checked for "relation")
 *   - relation?: { entity, displayField }
 */

"use client";

import { useQueries } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { unwrap } from "@/lib/supabase/query-helpers";
import { dynamicOptionsKeys } from "@/lib/query-keys";
import { CACHE_DURATIONS } from "@/lib/constants";
import { dynamicFrom } from "@/services/types";
import { log } from "@/lib/client-logger";

// Minimal field shape accepted by the hook - covers both EntityFieldDef and UnifiedFieldDef
type DynamicOptionsField = {
  name: string;
  type?: string;
  dynamicOptions?: {
    table: string;
    valueField: string;
    labelField: string;
    filter?: Record<string, unknown>;
    orderBy?: string;
  };
  relation?: {
    entity: string;
    displayField: string;
  };
}

export type DynamicOptionsResult = {
  optionsMap: Record<string, { value: string; label: string }[]>;
  isLoading: boolean;
}

export function useDynamicOptions(fields: DynamicOptionsField[]): DynamicOptionsResult {
  const supabase = createClient();

  // Get all fields that have dynamicOptions
  const dynamicFields = fields.filter((f) => f.dynamicOptions);

  // Get all relation fields (type: "relation" with field.relation config)
  const relationFields = fields.filter((f) => f.type === "relation" && f.relation);

  // Create queries for each dynamic field
  const dynamicQueries = useQueries({
    queries: dynamicFields.map((field) => ({
      queryKey: dynamicOptionsKeys.field(field.dynamicOptions!.table, field.name),
      queryFn: async () => {
        const { table, valueField, labelField, filter, orderBy } = field.dynamicOptions!;

        let query = dynamicFrom(supabase, table).select(`${valueField}, ${labelField}`);

        // Apply filters
        if (filter) {
          Object.entries(filter).forEach(([key, val]) => {
            query = query.eq(key, val);
          });
        }

        // Apply ordering
        if (orderBy) {
          query = query.order(orderBy);
        }

        const data = await unwrap(query);

        const rows = data as unknown as Record<string, unknown>[] | null;
        return {
          fieldName: field.name,
          options: (rows || []).map((row) => ({
            value: String(row[valueField]),
            label: String(row[labelField]),
          })),
        };
      },
      staleTime: CACHE_DURATIONS.STATIC_DATA,
    })),
  });

  // Create queries for relation fields
  // Import entityRegistry lazily to avoid circular dependency issues at module load time
  const relationQueries = useQueries({
    queries: relationFields.map((field) => {
      const relation = field.relation!;

      return {
        queryKey: dynamicOptionsKeys.field(relation.entity, field.name),
        queryFn: async () => {
          // Dynamically import to avoid circular dependency
          const { entityRegistry } = await import("@/entities");
          const relatedEntity = entityRegistry.get(relation.entity);
          const tableName = relatedEntity?.table || `${relation.entity}s`;

          const { data, error } = await dynamicFrom(supabase, tableName)
            .select(`id, ${relation.displayField}`)
            .order(relation.displayField);

          if (error) {
            log.error(`Failed to fetch options for ${field.name}:`, error);
            return { fieldName: field.name, options: [] };
          }

          const rows = data as unknown as Record<string, unknown>[] | null;
          return {
            fieldName: field.name,
            options: (rows || []).map((row) => ({
              value: String(row.id),
              label: String(row[relation.displayField]),
            })),
          };
        },
        staleTime: CACHE_DURATIONS.STATIC_DATA,
      };
    }),
  });

  const queries = [...dynamicQueries, ...relationQueries];

  // Combine results into a map of fieldName -> options
  const optionsMap: Record<string, { value: string; label: string }[]> = {};
  for (const query of queries) {
    if (query.data) {
      optionsMap[query.data.fieldName] = query.data.options;
    }
  }

  return {
    optionsMap,
    isLoading: queries.some((q) => q.isLoading),
  };
}
