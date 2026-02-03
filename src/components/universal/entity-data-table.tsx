"use client";

/**
 * EntityDataTable - Universal List Component (Dice UI)
 *
 * Renders a data table for any entity based on its configuration.
 * Uses Dice UI DataTable components with URL-synced filters via nuqs.
 *
 * Architecture:
 * - Entity configs are translated to Dice UI columns via data-table-adapter
 * - Filters are managed by DataTableFilterList via nuqs URL state
 * - Sorting is managed by TanStack Table state (DataTableSortList reads/writes via table)
 * - Data is fetched from Supabase and filtered server-side
 * - Pagination is handled client-side by TanStack Table
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import type { ColumnDef, SortingState, PaginationState } from "@tanstack/react-table";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
} from "@tanstack/react-table";
import { usePersistedPageSize } from "@/hooks/use-persisted-page-size";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { parseAsStringEnum } from "nuqs";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { entityKeys } from "@/lib/query-keys";
import { CACHE_DURATIONS } from "@/lib/constants";
import type { EntityConfig } from "@/types/entity";
import type { ExtendedColumnFilter } from "@/types/data-table";
import { getFiltersStateParser } from "@/lib/parsers";
import { EntityErrorBoundary } from "./entity-error-boundary";
import { BulkStatusActionBar } from "./bulk-status-action-bar";
import {
  buildDataTableColumns,
  buildSelectColumn,
  buildActionsColumn,
  buildSupabaseFiltersFromUrl,
  escapePostgrestOrValue,
} from "@/lib/data-table-adapter";
import { useDynamicFilterOptions } from "@/hooks/use-dynamic-filter-options";
import { useDebouncedCallback } from "@/hooks/use-debounced-callback";

import { DataTable } from "@/components/data-table/data-table";
import { DataTableAdvancedToolbar } from "@/components/data-table/data-table-advanced-toolbar";
import { DataTableFilterList } from "@/components/data-table/data-table-filter-list";
import { DataTableSortList } from "@/components/data-table/data-table-sort-list";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";

// =============================================================================
// Types
// =============================================================================

export interface EntityDataTableProps<T = Record<string, unknown>> {
  /** Entity configuration */
  entity: EntityConfig<T>;
  /** Base path for detail links (defaults to /{domain}/{table}) */
  basePath?: string;
  /** Additional query filters */
  filters?: Record<string, unknown>;
  /** Whether to show create button */
  showCreate?: boolean;
  /** Custom create handler (instead of link) */
  onCreateClick?: () => void;
  /** Custom action handler - return true if handled externally */
  onAction?: (actionName: string, record: T) => boolean;
}

// =============================================================================
// Component
// =============================================================================

export function EntityDataTable<T = Record<string, unknown>>({
  entity,
  basePath,
  filters,
  showCreate = true,
  onCreateClick,
  onAction,
}: EntityDataTableProps<T>) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const path = basePath || `/${entity.domain}/${entity.table}`;

  const hasBulkActions = !!entity.stateMachine;

  // ---------------------------------------------------------------------------
  // Dynamic filter options
  // ---------------------------------------------------------------------------
  const dynamicFilterOptions = useDynamicFilterOptions(
    entity.listFilters,
    entity.name
  );

  // ---------------------------------------------------------------------------
  // Table state
  // ---------------------------------------------------------------------------
  const [sorting, setSorting] = useState<SortingState>(
    entity.defaultSort
      ? [
          {
            id: entity.defaultSort.column,
            desc: entity.defaultSort.direction === "desc",
          },
        ]
      : []
  );
  const [globalFilter, setGlobalFilter] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debouncedSetSearch = useDebouncedCallback(setDebouncedSearch, 300);
  const [rowSelection, setRowSelection] = useState({});

  // Persisted page size
  const { pageSize: persistedPageSize, setPageSize: setPersistedPageSize } =
    usePersistedPageSize();
  const [pagination, setPagination] = useState<PaginationState>(() => ({
    pageIndex: 0,
    pageSize: persistedPageSize,
  }));

  // Debounce the global search
  useEffect(() => {
    debouncedSetSearch(globalFilter);
  }, [globalFilter, debouncedSetSearch]);

  // Reset when navigating between entities
  useEffect(() => {
    setGlobalFilter("");
    setRowSelection({});
  }, [entity.name]);

  // ---------------------------------------------------------------------------
  // Build columns (memoized, updates when dynamicFilterOptions change)
  // ---------------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns = useMemo((): ColumnDef<T, any>[] => {
    const dataColumns = buildDataTableColumns(entity, dynamicFilterOptions);
    const actionsColumn = buildActionsColumn(entity, path, onAction);

    if (hasBulkActions) {
      return [buildSelectColumn<T>(), ...dataColumns, actionsColumn];
    }
    return [...dataColumns, actionsColumn];
  }, [entity, dynamicFilterOptions, path, onAction, hasBulkActions]);

  // ---------------------------------------------------------------------------
  // URL-synced filter state (read from nuqs — DataTableFilterList writes here)
  // ---------------------------------------------------------------------------
  const filterableColumnIds = useMemo(
    () =>
      columns
        .filter((c) => c.enableColumnFilter)
        .map((c) => c.id)
        .filter(Boolean) as string[],
    [columns]
  );

  const [urlFilters] = useQueryState(
    "filters",
    getFiltersStateParser<T>(filterableColumnIds).withDefault([])
  );

  const [joinOperator] = useQueryState(
    "joinOperator",
    parseAsStringEnum(["and", "or"]).withDefault("and")
  );

  // Reset row selection when filters or search change
  useEffect(() => {
    setRowSelection({});
  }, [urlFilters, debouncedSearch]);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------
  const fetchTable = entity.viewTable || entity.table;

  // Build a stable key from URL filters for query cache
  const filterKey = useMemo(
    () =>
      urlFilters.length > 0
        ? {
            filters: urlFilters.map((f) => ({
              id: f.id,
              value: f.value,
              operator: f.operator,
            })),
            joinOperator,
          }
        : {},
    [urlFilters, joinOperator]
  );

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: entityKeys.list(fetchTable, {
      ...filters,
      ...filterKey,
      search: debouncedSearch || undefined,
    }),
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
    queryFn: async () => {
      let query = db.from(fetchTable).select("*");

      // Apply prop-level filters
      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          query = query.eq(key, value);
        });
      }

      // Apply URL filters from DataTableFilterList (translated to Supabase ops)
      const applyFilters = buildSupabaseFiltersFromUrl(
        urlFilters as ExtendedColumnFilter<T>[],
        joinOperator
      );
      query = applyFilters(query);

      // Apply global search (debounced)
      if (debouncedSearch && entity.searchableFields?.length) {
        const escaped = escapePostgrestOrValue(debouncedSearch);
        const searchCondition = entity.searchableFields
          .map((field) => `${field}.ilike.%${escaped}%`)
          .join(",");
        query = query.or(searchCondition);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as T[];
    },
  });

  // ---------------------------------------------------------------------------
  // Table instance
  // ---------------------------------------------------------------------------
  // Handle pagination changes, persisting page size when it changes
  const handlePaginationChange = useCallback(
    (updater: PaginationState | ((old: PaginationState) => PaginationState)) => {
      setPagination((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        // Persist page size if it changed
        if (next.pageSize !== prev.pageSize) {
          setPersistedPageSize(next.pageSize);
        }
        return next;
      });
    },
    [setPersistedPageSize]
  );

  const table = useReactTable({
    data: data || [],
    columns,
    state: {
      sorting,
      globalFilter,
      pagination,
      ...(hasBulkActions ? { rowSelection } : {}),
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: handlePaginationChange,
    ...(hasBulkActions
      ? { onRowSelectionChange: setRowSelection, enableRowSelection: true }
      : {}),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualFiltering: true,
  });

  // ---------------------------------------------------------------------------
  // Bulk action helpers
  // ---------------------------------------------------------------------------
  const selectedRows = useMemo(() => {
    if (!data) return [];
    return Object.entries(rowSelection)
      .filter(([, selected]) => selected)
      .map(([key]) => data[parseInt(key)])
      .filter(Boolean);
  }, [rowSelection, data]);

  const handleBulkStatusChange = useCallback(
    async (targetStatus: string) => {
      if (!entity.stateMachine || !targetStatus || selectedRows.length === 0)
        return;

      const stateField = entity.stateMachine.stateField;
      const transitions = entity.stateMachine.transitions;
      const ids = selectedRows.map(
        (row) => (row as Record<string, unknown>).id as string
      );

      // Fetch current states to validate transitions server-side
      const { data: currentData, error: fetchError } = await db
        .from(entity.table)
        .select(`id, ${stateField}`)
        .in("id", ids);

      if (fetchError) throw fetchError;

      // Only update rows where transition is valid
      const validIds = (currentData || [])
        .filter((row: Record<string, unknown>) => {
          const currentState = row[stateField] as string;
          const allowed = transitions[currentState] || [];
          return allowed.includes(targetStatus);
        })
        .map((row: Record<string, unknown>) => row.id as string);

      if (validIds.length === 0) {
        toast.error("No valid transitions available. Data may have changed.");
        return 0;
      }

      const { error } = await db
        .from(entity.table)
        .update({ [stateField]: targetStatus })
        .in("id", validIds);

      if (error) throw error;

      // Invalidate queries
      queryClient.invalidateQueries({
        queryKey: entityKeys.all(fetchTable),
      });
      if (entity.viewTable) {
        queryClient.invalidateQueries({
          queryKey: entityKeys.all(entity.table),
        });
      }

      // Clear selection
      setRowSelection({});

      return validIds.length;
    },
    [entity, selectedRows, db, queryClient, fetchTable]
  );

  // ---------------------------------------------------------------------------
  // Error state
  // ---------------------------------------------------------------------------
  if (error) {
    return (
      <div className="text-center py-8 text-destructive">
        Failed to load {entity.displayNamePlural.toLowerCase()}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Check for active filters
  // ---------------------------------------------------------------------------
  const hasActiveFilters = debouncedSearch || urlFilters.length > 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{entity.displayNamePlural}</h1>
        {showCreate && (
          <Button asChild={!onCreateClick} onClick={onCreateClick}>
            {onCreateClick ? (
              `New ${entity.displayName}`
            ) : (
              <Link href={`${path}/new`}>New {entity.displayName}</Link>
            )}
          </Button>
        )}
      </div>

      {/* Data Table */}
      <div
        className={cn("relative", isFetching && !isLoading && "opacity-60")}
      >
        {/* Refetch indicator */}
        {isFetching && !isLoading && (
          <div className="absolute top-2 right-2 z-10">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}

        {isLoading ? (
          <LoadingSkeleton columnCount={entity.listColumns.length + 1} />
        ) : (
          <DataTable
            table={table}
            actionBar={
              hasBulkActions && selectedRows.length > 0 ? (
                <BulkStatusActionBar
                  entity={entity}
                  selectedRows={selectedRows}
                  onStatusChange={handleBulkStatusChange}
                  onClearSelection={() => setRowSelection({})}
                />
              ) : undefined
            }
            noResultsContent={
              <div className="flex flex-col items-center justify-center gap-3 py-8">
                <div className="text-muted-foreground text-center">
                  {hasActiveFilters ? (
                    <>
                      <p className="font-medium">
                        No matching{" "}
                        {entity.displayNamePlural.toLowerCase()}
                      </p>
                      <p className="text-sm">
                        Try adjusting your search or filters
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium">
                        No {entity.displayNamePlural.toLowerCase()} yet
                      </p>
                      <p className="text-sm">
                        Get started by creating your first{" "}
                        {entity.displayName.toLowerCase()}
                      </p>
                    </>
                  )}
                </div>
                {showCreate && !hasActiveFilters && (
                  <>
                    {onCreateClick ? (
                      <Button size="sm" onClick={onCreateClick}>
                        Create {entity.displayName}
                      </Button>
                    ) : (
                      <Button size="sm" asChild>
                        <Link href={`${path}/new`}>
                          Create {entity.displayName}
                        </Link>
                      </Button>
                    )}
                  </>
                )}
              </div>
            }
          >
            <DataTableAdvancedToolbar table={table}>
              {/* Global search */}
              {entity.searchableFields &&
                entity.searchableFields.length > 0 && (
                  <div className="relative max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder={`Search ${entity.displayNamePlural.toLowerCase()}...`}
                      value={globalFilter}
                      onChange={(e) => setGlobalFilter(e.target.value)}
                      className="pl-10 h-8"
                    />
                  </div>
                )}
              <DataTableFilterList table={table} />
              <DataTableSortList table={table} />
            </DataTableAdvancedToolbar>
          </DataTable>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Loading Skeleton
// =============================================================================

function LoadingSkeleton({ columnCount }: { columnCount: number }) {
  return (
    <div className="border rounded-lg">
      <Table>
        <TableBody>
          {Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={i}>
              {Array.from({ length: columnCount }).map((_, j) => (
                <TableCell key={j}>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// =============================================================================
// Re-exports for backward compatibility
// =============================================================================

export type EntityListProps<T = Record<string, unknown>> =
  EntityDataTableProps<T>;

export { EntityDataTable as EntityList };

export function EntityDataTableWithErrorBoundary<
  T = Record<string, unknown>,
>(props: EntityDataTableProps<T>) {
  return (
    <EntityErrorBoundary
      entity={props.entity as EntityConfig<Record<string, unknown>>}
    >
      <EntityDataTable {...props} />
    </EntityErrorBoundary>
  );
}

export { EntityDataTableWithErrorBoundary as EntityListWithErrorBoundary };
