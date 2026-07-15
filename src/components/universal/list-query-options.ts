/**
 * Shared list query-options factory for the sitewide loading pattern
 * (see docs/plans/2026-07-15-sitewide-loading-pattern.md).
 *
 * The list query (Supabase select + per-relation FK resolution) and its React
 * Query key are built here so BOTH consume one source of truth:
 * - the client `useQuery` in entity-data-table.tsx (interactive: filters,
 *   search, sort, pagination), and
 * - a server component's `prefetchQuery` (initial paged render), which must
 *   produce the EXACT same key so the client hydrates without a second
 *   skeleton or a key mismatch.
 *
 * `listQueryKey`/`listQueryOptions` take already-resolved params (the client
 * computes them from hook state; the server uses `defaultListParams`). Keeping
 * the key construction identical to the previous inline version is what makes
 * this refactor behavior-preserving.
 *
 * No "use client" — this module runs on the server during prefetch. It only
 * uses pure helpers (adapter translation, entity registry) plus whatever
 * Supabase client the caller passes in.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { entityKeys } from "@/lib/query-keys";
import { dynamicFrom } from "@/services/types";
import type { EntityConfig, EntityColumnDef } from "@/types/entity";
import { entityRegistry } from "@/types/entity";
import type { ExtendedColumnFilter } from "@/types/data-table";

/**
 * The slice of an entity these list-query helpers actually read. Kept minimal
 * (and everything but `table` optional) so a server component can pass the
 * client-free `*Core` half — the assembled `EntityConfig` (a client module,
 * because presentation.tsx renders JSX) can't be imported into a Server
 * Component. A full `EntityConfig<T>` structurally satisfies this.
 *
 * Note: entities whose LIST columns include a `relation` need those columns'
 * FK metadata (accessorKey + relation) at prefetch time to resolve `__rel_`
 * display values server-side. A core without `listColumns` skips that loop, so
 * such pages must supply the relation metadata (or make their list columns
 * server-safe) before adopting server prefetch. Batches have no relation list
 * columns, so the core alone prefetches identically.
 */
export type ListQueryEntity<T> = Pick<EntityConfig<T>, "table"> &
  Partial<
    Pick<
      EntityConfig<T>,
      | "viewTable"
      | "defaultSort"
      | "searchableFields"
      | "listColumns"
      | "listRelations"
      | "listFilters"
      | "quickFilters"
      | "stateMachine"
      | "detailHeader"
      | "actions"
    >
  >;
import {
  buildSupabaseFiltersFromUrl,
  escapePostgrestOrValue,
  REL_KEY_PREFIX,
} from "@/components/data-table/adapter";

/**
 * Column ids the entity config provably places on the fetched table/view:
 * `id` ∪ listColumns ∪ listFilters ∪ defaultSort ∪ quickFilter sort columns.
 * Shared core for the safe ORDER BY targets (orderableColumnIds) and the
 * select-list projection (buildSelectList, which extends it).
 */
export function configColumnIds<T>(entity: ListQueryEntity<T>): Set<string> {
  const ids = new Set<string>(["id"]);
  for (const c of entity.listColumns ?? []) {
    if (c.accessorKey) ids.add(c.accessorKey as string);
  }
  for (const f of entity.listFilters ?? []) ids.add(f.field);
  if (entity.defaultSort) ids.add(entity.defaultSort.column);
  for (const qf of entity.quickFilters ?? []) {
    if (qf.sort) ids.add(qf.sort.column);
  }
  return ids;
}

/**
 * Build the PostgREST select list for the list query from entity config.
 *
 * Projection is only safe when no code path can read arbitrary row fields.
 * Falls back to "*" when:
 * - a listColumn has a custom `render` function (receives the whole row)
 * - an action has `handler`/`showWhen`/`disabledWhen` (receive the whole record)
 * - an `onAction` prop is passed (page-level handlers receive the record)
 * - a delete action exists without `detailHeader.title` (delete dialog falls
 *   back to reading `record.name`, which we can't prove exists)
 *
 * Otherwise projects configColumnIds ∪ stateField ∪ detailHeader.title
 * ∪ searchableFields ∪ quickFilter filter columns ∪ prop-filter keys.
 */
export function buildSelectList<T>(
  entity: ListQueryEntity<T>,
  propFilters: Record<string, unknown> | undefined,
  hasOnAction: boolean
): string {
  if (hasOnAction) return "*";
  if ((entity.listColumns ?? []).some((c) => c.render)) return "*";
  if (entity.actions?.some((a) => a.handler || a.showWhen || a.disabledWhen)) return "*";
  if (entity.actions?.some((a) => a.deleteMode) && !entity.detailHeader?.title) return "*";

  const cols = configColumnIds(entity);
  if (entity.stateMachine) cols.add(entity.stateMachine.stateField as string);
  if (entity.detailHeader?.title) cols.add(entity.detailHeader.title as string);
  for (const s of entity.searchableFields ?? []) cols.add(s as string);
  for (const qf of entity.quickFilters ?? []) {
    for (const f of qf.filters) cols.add(f.column);
  }
  for (const k of Object.keys(propFilters ?? {})) cols.add(k);
  return [...cols].join(",");
}

/**
 * Resolved inputs for one list query. The client computes these from hook
 * state each render; the server derives them from `defaultListParams` for the
 * initial paged view.
 */
export type ResolvedListParams<T = Record<string, unknown>> = {
  /** Table/view actually queried (entity.viewTable ?? entity.table). */
  fetchTable: string;
  /** Prop-level equality filters (the `filters` prop on EntityDataTable). */
  propFilters?: Record<string, unknown>;
  /** URL filters from DataTableFilterList. */
  urlFilters: ExtendedColumnFilter<T>[];
  joinOperator: "and" | "or";
  /** Debounced global search (undefined when empty). */
  search?: string;
  mode: "paged" | "mobile" | "board";
  from: number;
  to: number;
  order: readonly { column: string; ascending: boolean }[];
  select: string;
};

/** Cache shape of the paged list query. */
export type PagedListData<T = Record<string, unknown>> = {
  rows: T[];
  totalCount: number | null;
};

/**
 * Build the React Query key for a list query. Identical construction to the
 * previous inline version in entity-data-table so existing cache entries and
 * invalidations (entityKeys.all(table) covers `[table, "list", ...]`) still
 * match, and so server prefetch + client first render hit the same key.
 */
export function listQueryKey<T>(params: ResolvedListParams<T>) {
  const { fetchTable, propFilters, urlFilters, joinOperator, search, mode, from, to, order, select } =
    params;
  const filterKey =
    urlFilters.length > 0
      ? {
          filters: urlFilters.map((f) => ({
            id: f.id,
            value: f.value,
            operator: f.operator,
          })),
          joinOperator,
        }
      : {};
  return entityKeys.pagedList(
    fetchTable,
    { ...propFilters, ...filterKey, search: search || undefined },
    { mode, from, to, order, select }
  );
}

/**
 * Run the list query: main Supabase select (filters + search + server sort +
 * fetch window) followed by the per-relation FK-resolution loop that populates
 * `__rel_<key>` display values on each row. Extracted verbatim from the
 * previous entity-data-table queryFn.
 */
export async function runListQuery<T>(
  supabase: SupabaseClient,
  entity: ListQueryEntity<T>,
  params: ResolvedListParams<T>
): Promise<PagedListData<T>> {
  const { fetchTable, propFilters, urlFilters, joinOperator, search, order, from, to, select } =
    params;

  let query = dynamicFrom(supabase, fetchTable).select(select, {
    count: "estimated",
  });

  // Apply prop-level filters
  if (propFilters) {
    Object.entries(propFilters).forEach(([key, value]) => {
      query = query.eq(key, value);
    });
  }

  // Apply URL filters from DataTableFilterList (translated to Supabase ops)
  const applyFilters = buildSupabaseFiltersFromUrl(urlFilters, joinOperator);
  query = applyFilters(query);

  // Apply global search (debounced)
  if (search && entity.searchableFields?.length) {
    const escaped = escapePostgrestOrValue(search);
    const searchCondition = entity.searchableFields
      .map((field) => `${field}.ilike.%${escaped}%`)
      .join(",");
    query = query.or(searchCondition);
  }

  // Server-side sort + fetch window
  for (const o of order) {
    query = query.order(o.column, { ascending: o.ascending });
  }
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];

  // Batch-resolve FK relation columns (parallel, one query per relation table).
  // The client path reads them from listColumns; a server prefetch (no client
  // presentation) falls back to the core's server-safe listRelations mirror.
  // Both yield the same { accessorKey, relation } so resolution is identical.
  const relationCols = (entity.listColumns ?? [])
    .filter((c: EntityColumnDef<T>) => c.relation && c.accessorKey)
    .map((c) => ({ accessorKey: c.accessorKey as string, relation: c.relation! }));
  const relations = relationCols.length > 0 ? relationCols : entity.listRelations ?? [];
  await Promise.allSettled(
    relations.map(async (col) => {
      const key = col.accessorKey;
      const uniqueIds = [...new Set(rows.map((r) => r[key]).filter(Boolean))] as string[];
      if (uniqueIds.length === 0) return;

      const relEntity = entityRegistry.get(col.relation.entity);
      const table = relEntity?.table ?? `${col.relation.entity}s`;
      const displayField = col.relation.displayField;

      const { data: relData } = await dynamicFrom(supabase, table)
        .select(`id, ${displayField}`)
        .in("id", uniqueIds);

      if (relData) {
        const lookup = new Map(
          relData.map((r: Record<string, unknown>) => [r.id as string, r[displayField] as string])
        );
        for (const row of rows) {
          const fkVal = row[key] as string | null;
          if (fkVal && lookup.has(fkVal)) {
            row[`${REL_KEY_PREFIX}${key}`] = lookup.get(fkVal);
          }
        }
      }
    })
  );

  return { rows: rows as T[], totalCount: count as number | null };
}

/**
 * React Query options ({ queryKey, queryFn }) for a list query — the single
 * factory both the client `useQuery` and the server `prefetchQuery` consume.
 */
export function listQueryOptions<T>(
  supabase: SupabaseClient,
  entity: ListQueryEntity<T>,
  params: ResolvedListParams<T>
) {
  return {
    queryKey: listQueryKey(params),
    queryFn: () => runListQuery(supabase, entity, params),
  };
}

/**
 * Resolved params for the INITIAL paged render — the state the client
 * reproduces on first mount (no filters, no search, page 0, default sort,
 * default page size). A server component prefetches with these so its key
 * exactly matches the client's first-render key.
 *
 * `hasOnAction` mirrors whether the page passes an `onAction` prop (forces a
 * `*` projection, see buildSelectList). `pageSize` defaults to the app-wide
 * default (10, from usePersistedPageSize) which is also the client's first
 * pre-hydration render value.
 */
export function defaultListParams<T>(
  entity: ListQueryEntity<T>,
  {
    hasOnAction = false,
    propFilters,
    pageSize = 10,
    select,
  }: {
    hasOnAction?: boolean;
    propFilters?: Record<string, unknown>;
    pageSize?: number;
    /**
     * Explicit projection override. buildSelectList returns "*" whenever a list
     * column has a custom `render` (among other cases) — the server can't see
     * those render fns (they live in the client presentation), so a page whose
     * client list renders "*" passes `select: "*"` here to match its first key.
     */
    select?: string;
  } = {}
): ResolvedListParams<T> {
  // Server ORDER BY: entity default sort + unique `id` tiebreaker (matches the
  // client's orderSpec for the no-explicit-sort first render).
  const order: { column: string; ascending: boolean }[] = [];
  if (entity.defaultSort) {
    order.push({
      column: entity.defaultSort.column,
      ascending: entity.defaultSort.direction === "asc",
    });
  }
  if (!order.some((o) => o.column === "id")) {
    order.push({ column: "id", ascending: true });
  }

  return {
    fetchTable: entity.viewTable || entity.table,
    propFilters,
    urlFilters: [],
    joinOperator: "and",
    search: undefined,
    mode: "paged",
    from: 0,
    to: pageSize - 1,
    order,
    select: select ?? buildSelectList(entity, propFilters, hasOnAction),
  };
}
