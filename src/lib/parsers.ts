import { createParser } from "nuqs/server";
import { z } from "zod";

import { dataTableConfig } from "@/lib/data-table-config";

import type {
  ExtendedColumnFilter,
  ExtendedColumnSort,
} from "@/types/data-table";

/** Deep equality for filter values (handles arrays) */
function deepEqualValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return false;
}

const sortingItemSchema = z.object({
  id: z.string(),
  desc: z.boolean(),
});

/**
 * nuqs parser for URL-synced table sort state (audit F-082).
 * Serializes TanStack `SortingState` as JSON, e.g.
 * `?sort=[{"id":"name","desc":false}]`. `columnIds` is an allowlist of
 * sortable column ids — a URL naming any other column fails parsing and
 * nuqs falls back to the default (the entity's defaultSort) silently.
 */
export const getSortingStateParser = <TData>(
  columnIds?: string[] | Set<string>,
) => {
  const validKeys = columnIds
    ? columnIds instanceof Set
      ? columnIds
      : new Set(columnIds)
    : null;

  return createParser({
    parse: (value) => {
      try {
        const parsed = JSON.parse(value);
        const result = z.array(sortingItemSchema).safeParse(parsed);

        if (!result.success) return null;

        if (validKeys && result.data.some((item) => !validKeys.has(item.id))) {
          return null;
        }

        return result.data as ExtendedColumnSort<TData>[];
      } catch {
        return null;
      }
    },
    serialize: (value) => JSON.stringify(value),
    eq: (a, b) =>
      a.length === b.length &&
      a.every(
        (item, index) =>
          item.id === b[index]?.id && item.desc === b[index]?.desc,
      ),
  });
};

const filterItemSchema = z.object({
  id: z.string(),
  value: z.union([z.string(), z.array(z.string())]),
  variant: z.enum(dataTableConfig.filterVariants),
  operator: z.enum(dataTableConfig.operators),
  filterId: z.string(),
});

export type FilterItemSchema = z.infer<typeof filterItemSchema>;

/**
 * Whether two filter states are equivalent. Comparison is positional (same
 * length and same id/value/variant/operator at each index), including array
 * values. Shared by the parser's `eq`/`clearOnDefault` check and by callers
 * that need to know whether URL filters still match the default preset.
 */
export function filterStatesEqual<TData>(
  a: ExtendedColumnFilter<TData>[],
  b: ExtendedColumnFilter<TData>[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (filter, index) =>
        filter.id === b[index]?.id &&
        deepEqualValue(filter.value, b[index]?.value) &&
        filter.variant === b[index]?.variant &&
        filter.operator === b[index]?.operator,
    )
  );
}

/**
 * Count of user-applied filters, treating a match against the entity's
 * default quick-filter preset as zero: `urlFilters` defaults to that preset
 * (see `getFiltersStateParser(...).withDefault(defaultQuickFilterFilters)`
 * in entity-data-table.tsx), so its raw `.length` is non-zero from first
 * paint for any entity with an `isDefault: true` quick filter (currently
 * `batch`) even though the user has narrowed nothing.
 */
export function activeFilterCount<TData>(
  urlFilters: ExtendedColumnFilter<TData>[],
  defaultFilters: ExtendedColumnFilter<TData>[],
): number {
  return filterStatesEqual(urlFilters, defaultFilters) ? 0 : urlFilters.length;
}

/**
 * nuqs parser for URL-synced table filter state.
 *
 * Validates each filter INDIVIDUALLY and drops only the bad ones: a saved or
 * bookmarked URL holding a filter whose column no longer exists, or whose
 * `variant`/`operator` has since been removed from `dataTableConfig`, keeps its
 * remaining still-valid filters instead of silently losing all of them.
 */
export const getFiltersStateParser = <TData>(
  columnIds?: string[] | Set<string>,
) => {
  const validKeys = columnIds
    ? columnIds instanceof Set
      ? columnIds
      : new Set(columnIds)
    : null;

  return createParser({
    parse: (value) => {
      try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed)) return null;

        const kept = parsed.flatMap((item) => {
          const result = filterItemSchema.safeParse(item);
          if (!result.success) return [];
          if (validKeys && !validKeys.has(result.data.id)) return [];
          return [result.data];
        });

        return kept as ExtendedColumnFilter<TData>[];
      } catch {
        return null;
      }
    },
    serialize: (value) => JSON.stringify(value),
    eq: filterStatesEqual,
  });
};
