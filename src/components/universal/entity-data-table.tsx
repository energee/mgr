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
import { useRouter } from "next/navigation";
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
import { dynamicFrom } from "@/services/types";
import { entityKeys } from "@/lib/query-keys";
import { CACHE_DURATIONS } from "@/lib/constants";
import type { EntityConfig, EntityActionDef } from "@/types/entity";
import { getStateLabel } from "@/types/entity";
import type { ExtendedColumnFilter } from "@/types/data-table";
import { getFiltersStateParser } from "@/lib/parsers";
import { EntityErrorBoundary } from "./entity-error-boundary";
import { EntityKanban } from "@/components/universal/entity-kanban";
import { EntityDeleteDialog } from "./entity-delete-dialog";
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
import { useKeyboardShortcuts, type KeyboardShortcut } from "@/hooks/use-keyboard-shortcuts";
import { useIsMobile } from "@/hooks/use-mobile";
import { generateId } from "@/lib/id";
import { EntityMobileCardList } from "./entity-mobile-card-list";

import { DataTable } from "@/components/data-table/data-table";
import { DataTableAdvancedToolbar } from "@/components/data-table/data-table-advanced-toolbar";
import { DataTableFilterList } from "@/components/data-table/data-table-filter-list";
import { DataTableSortList } from "@/components/data-table/data-table-sort-list";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Inbox, LayoutList, Kanban as KanbanIcon } from "lucide-react";
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

export type EntityDataTableProps<T = Record<string, unknown>> = {
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
  const path = basePath || `/${entity.domain}/${entity.table}`;
  const router = useRouter();
  const [deleteTarget, setDeleteTarget] = useState<{ record: T; action: EntityActionDef<T> } | null>(null);

  const isMobile = useIsMobile();
  const hasBulkActions = !!entity.stateMachine;
  const fetchTable = entity.viewTable || entity.table;

  // ---------------------------------------------------------------------------
  // Single item state transition (used by kanban drag-and-drop + row actions)
  // ---------------------------------------------------------------------------
  const handleSingleTransition = useCallback(
    async (id: string, toState: string) => {
      if (!entity.stateMachine) return;

      const stateField = entity.stateMachine.stateField;
      const transitions = entity.stateMachine.transitions;

      const loadingId = toast.loading("Updating status...");

      // Validate transition is allowed before hitting the database
      const { data: current } = await dynamicFrom(supabase, entity.table)
        .select(stateField)
        .eq("id", id)
        .single();

      const currentState = current?.[stateField] as string | undefined;
      if (!currentState || !transitions[currentState]?.includes(toState)) {
        toast.dismiss(loadingId);
        toast.error("Transition no longer valid — status may have changed");
        queryClient.invalidateQueries({ queryKey: entityKeys.all(fetchTable) });
        return;
      }

      // Include current state in WHERE to prevent race conditions:
      // if another user changed the state between our SELECT and UPDATE,
      // this UPDATE will match 0 rows, and .select() returns an empty array.
      const { data: _updated, error } = await dynamicFrom(supabase, entity.table)
        .update({ [stateField]: toState })
        .eq("id", id)
        .eq(stateField, currentState)
        .select("id");

      if (error) {
        toast.dismiss(loadingId);
        toast.error("Failed to update status");
        return;
      }

      queryClient.invalidateQueries({
        queryKey: entityKeys.all(fetchTable),
      });
      if (entity.viewTable) {
        queryClient.invalidateQueries({
          queryKey: entityKeys.all(entity.table),
        });
      }

      toast.dismiss(loadingId);
      toast.success(`Status updated to ${getStateLabel(entity, toState)}`);
    },
    [entity, supabase, queryClient, fetchTable],
  );

  // ---------------------------------------------------------------------------
  // View mode (table vs board)
  // ---------------------------------------------------------------------------
  const [viewMode, setViewMode] = useQueryState(
    "view",
    parseAsStringEnum(["table", "board"]).withDefault("table")
  );

  // ---------------------------------------------------------------------------
  // "n" hotkey for New entity (uses useKeyboardShortcuts to skip in inputs)
  // ---------------------------------------------------------------------------
  const listShortcuts = useMemo<KeyboardShortcut[]>(() => {
    if (!showCreate) return [];
    return [
      {
        key: "n",
        label: "N",
        description: `Create new ${entity.displayName.toLowerCase()}`,
        handler: () => {
          if (onCreateClick) {
            onCreateClick();
          } else {
            router.push(`${path}/new`);
          }
        },
      },
    ];
  }, [showCreate, onCreateClick, router, path, entity.displayName]);
  useKeyboardShortcuts(listShortcuts);

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
  const defaultSorting: SortingState = useMemo(
    () =>
      entity.defaultSort
        ? [{ id: entity.defaultSort.column, desc: entity.defaultSort.direction === "desc" }]
        : [],
    [entity.defaultSort]
  );
  const [sorting, setSorting] = useState<SortingState>(defaultSorting);
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
  const columns = useMemo((): ColumnDef<T>[] => {
    const dataColumns = buildDataTableColumns(entity, dynamicFilterOptions);
    const actionsColumn = buildActionsColumn(
      entity,
      path,
      onAction,
      handleSingleTransition,
      (record, action) => setDeleteTarget({ record, action })
    );

    if (hasBulkActions) {
      return [buildSelectColumn<T>(), ...dataColumns, actionsColumn];
    }
    return [...dataColumns, actionsColumn];
  }, [entity, dynamicFilterOptions, path, onAction, hasBulkActions, handleSingleTransition]);

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

  const [urlFilters, setUrlFilters] = useQueryState(
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
  // Quick filter tabs
  // ---------------------------------------------------------------------------
  const quickFilters = entity.quickFilters;

  // Derive active quick filter tab from current URL filters
  const activeQuickFilter = useMemo(() => {
    if (!quickFilters) return undefined;
    return quickFilters.find((qf) =>
      qf.filters.every((preset) => {
        const match = urlFilters.find(
          (f) => f.id === preset.column && f.operator === "inArray"
        );
        if (!match) return false;
        const val = Array.isArray(match.value) ? match.value : [match.value];
        return (
          val.length === preset.values.length &&
          preset.values.every((v) => val.includes(v))
        );
      })
    );
  }, [quickFilters, urlFilters]);

  const activeTabValue = activeQuickFilter?.label ?? "_all";

  // Apply default quick filter on initial load (when no filters are set)
  const hasAppliedDefault = useMemo(() => ({ current: false }), []);
  useEffect(() => {
    if (!quickFilters || hasAppliedDefault.current) return;
    hasAppliedDefault.current = true;

    // Only apply default if no URL filters exist at all
    if (urlFilters.length > 0) return;

    const defaultFilter = quickFilters.find((qf) => qf.isDefault);
    if (defaultFilter) {
      setUrlFilters(
        defaultFilter.filters.map((preset) => ({
          id: preset.column,
          value: preset.values,
          variant: "multiSelect",
          operator: "inArray",
          filterId: generateId({ length: 8 }),
        })) as ExtendedColumnFilter<T>[]
      );
      if (defaultFilter.sort) {
        setSorting([{ id: defaultFilter.sort.column, desc: defaultFilter.sort.direction === "desc" }]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally omits urlFilters to avoid re-running after default is applied; hasAppliedDefault guard ensures single execution
  }, [quickFilters]);

  const handleQuickFilterChange = useCallback(
    (tabValue: string) => {
      if (!quickFilters) return;

      // "All" tab — remove quick filter columns from URL filters
      if (tabValue === "_all") {
        const quickColumns = new Set(
          quickFilters.flatMap((qf) => qf.filters.map((f) => f.column))
        );
        setUrlFilters(
          urlFilters.filter((f) => !quickColumns.has(f.id as string))
        );
        setSorting(defaultSorting);
        return;
      }

      const qf = quickFilters.find((q) => q.label === tabValue);
      if (!qf) return;

      // Remove existing filters for quick filter columns, then add presets
      const quickColumns = new Set(qf.filters.map((f) => f.column));
      const preserved = urlFilters.filter(
        (f) => !quickColumns.has(f.id as string)
      );
      const newFilters = qf.filters.map((preset) => ({
        id: preset.column,
        value: preset.values,
        variant: "multiSelect",
        operator: "inArray",
        filterId: generateId({ length: 8 }),
      }));
      setUrlFilters([...preserved, ...newFilters] as ExtendedColumnFilter<T>[]);

      // Apply sort override if defined, otherwise revert to default
      if (qf.sort) {
        setSorting([{ id: qf.sort.column, desc: qf.sort.direction === "desc" }]);
      } else {
        setSorting(defaultSorting);
      }
    },
    [quickFilters, urlFilters, setUrlFilters, defaultSorting]
  );

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

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
      let query = dynamicFrom(supabase, fetchTable).select("*");

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

  // Check if selected rows have any common valid transitions
  const hasValidBulkTransitions = useMemo(() => {
    if (!entity.stateMachine || selectedRows.length === 0) return false;

    const stateField = entity.stateMachine.stateField;
    const transitions = entity.stateMachine.transitions;

    // Get the set of current states for all selected rows
    const currentStates = new Set(
      selectedRows.map(
        (row) => (row as Record<string, unknown>)[stateField] as string
      )
    );

    // Find transitions valid for ALL selected items
    let commonTargets: string[] | null = null;
    for (const state of currentStates) {
      const allowed = transitions[state] || [];
      if (commonTargets === null) {
        commonTargets = [...allowed];
      } else {
        commonTargets = commonTargets.filter((t) => allowed.includes(t));
      }
    }

    return (commonTargets || []).length > 0;
  }, [entity.stateMachine, selectedRows]);

  const handleBulkStatusChange = useCallback(
    async (targetStatus: string) => {
      if (!entity.stateMachine || !targetStatus || selectedRows.length === 0)
        return;

      const stateField = entity.stateMachine.stateField;
      const transitions = entity.stateMachine.transitions;
      const ids = selectedRows.map(
        (row) => (row as Record<string, unknown>).id as string
      );

      const loadingId = toast.loading(`Updating ${ids.length} item${ids.length === 1 ? "" : "s"}...`);

      // Fetch current states to validate transitions server-side
      const { data: currentData, error: fetchError } = await dynamicFrom(supabase, entity.table)
        .select(`id, ${stateField}`)
        .in("id", ids);

      if (fetchError) {
        toast.dismiss(loadingId);
        throw fetchError;
      }

      // Only update rows where transition is valid
      const validIds = (currentData || [])
        .filter((row: Record<string, unknown>) => {
          const currentState = row[stateField] as string;
          const allowed = transitions[currentState] || [];
          return allowed.includes(targetStatus);
        })
        .map((row: Record<string, unknown>) => row.id as string);

      if (validIds.length === 0) {
        toast.dismiss(loadingId);
        toast.error("No valid transitions available. Data may have changed.");
        return 0;
      }

      const { error } = await dynamicFrom(supabase, entity.table)
        .update({ [stateField]: targetStatus })
        .in("id", validIds);

      if (error) {
        toast.dismiss(loadingId);
        throw error;
      }

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

      toast.dismiss(loadingId);
      return validIds.length;
    },
    [entity, selectedRows, supabase, queryClient, fetchTable]
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
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">{entity.displayNamePlural}</h1>
        <div className="flex items-center gap-2">
          {entity.stateMachine && entity.kanbanConfig && (
            <div className="flex gap-0.5">
              <Button
                variant={viewMode === "table" ? "secondary" : "ghost"}
                size="icon-xs"
                onClick={() => setViewMode("table")}
                aria-label="Table view"
                aria-pressed={viewMode === "table"}
              >
                <LayoutList className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant={viewMode === "board" ? "secondary" : "ghost"}
                size="icon-xs"
                onClick={() => setViewMode("board")}
                aria-label="Board view"
                aria-pressed={viewMode === "board"}
              >
                <KanbanIcon className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          {showCreate && (
            <Button variant="ghost" size="sm" asChild={!onCreateClick} onClick={onCreateClick}>
              {onCreateClick ? (
                <>
                  <span className="text-lg leading-none">+</span>
                  New
                </>
              ) : (
                <Link href={`${path}/new`}>
                  <span className="text-lg leading-none">+</span>
                  New
                </Link>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Quick Filter Tabs */}
      {quickFilters && quickFilters.length > 0 && (
        <Tabs
          value={activeTabValue}
          onValueChange={handleQuickFilterChange}
        >
          <TabsList>
            {quickFilters.map((qf) => (
              <TabsTrigger key={qf.label} value={qf.label}>
                {qf.label}
              </TabsTrigger>
            ))}
            <TabsTrigger value="_all">All</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {/* Data Table or Kanban Board */}
      <div
        className={cn("relative", isFetching && !isLoading && "opacity-60")}
      >
        {/* Refetch indicator */}
        {isFetching && !isLoading && (
          <div className="absolute top-2 right-2 z-10">
            <div role="status">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="sr-only">Loading</span>
            </div>
          </div>
        )}

        {isLoading ? (
          <LoadingSkeleton columnCount={entity.listColumns.length + 1} />
        ) : viewMode === "board" && entity.kanbanConfig ? (
          <EntityKanban
            entity={entity}
            data={data || []}
            basePath={path}
            onTransition={handleSingleTransition}
          />
        ) : isMobile ? (
          <>
            {/* Search bar for mobile */}
            {entity.searchableFields && entity.searchableFields.length > 0 && (
              <div className="relative mb-3">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder={`Search ${entity.displayNamePlural.toLowerCase()}...`}
                  value={globalFilter}
                  onChange={(e) => setGlobalFilter(e.target.value)}
                  className="pl-8 h-8 text-sm"
                />
              </div>
            )}
            <EntityMobileCardList
              entity={entity as EntityConfig<Record<string, unknown>>}
              data={(data || []) as Record<string, unknown>[]}
              basePath={path}
              showCreate={showCreate}
              onCreateClick={onCreateClick}
              hasActiveFilters={!!hasActiveFilters}
            />
          </>
        ) : (
          <DataTable
            table={table}
            actionBar={
              hasBulkActions && selectedRows.length > 0 && hasValidBulkTransitions ? (
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
                {hasActiveFilters ? (
                  <Search className="size-10 text-muted-foreground/30" />
                ) : (
                  <Inbox className="size-10 text-muted-foreground/30" />
                )}
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
                  <div className="relative w-full sm:w-auto sm:min-w-[220px] sm:max-w-sm">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder={`Search ${entity.displayNamePlural.toLowerCase()}...`}
                      value={globalFilter}
                      onChange={(e) => setGlobalFilter(e.target.value)}
                      className="pl-8 pr-8 h-7 text-xs border-transparent bg-transparent focus-visible:border-border focus-visible:bg-background"
                    />
                    {!globalFilter && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true">
                        <Kbd>/</Kbd>
                      </div>
                    )}
                  </div>
                )}
              <DataTableFilterList table={table} />
              <DataTableSortList table={table} />
            </DataTableAdvancedToolbar>
          </DataTable>
        )}
      </div>

      {/* Entity Delete Dialog */}
      {deleteTarget?.action.deleteMode && (
        <EntityDeleteDialog
          entityTable={entity.table}
          entityDisplayName={entity.displayName}
          recordId={String((deleteTarget.record as Record<string, unknown>).id)}
          recordTitle={String(
            (deleteTarget.record as Record<string, unknown>)[
              entity.detailHeader?.title ?? "name"
            ] ?? entity.displayName
          )}
          deleteMode={deleteTarget.action.deleteMode}
          open={!!deleteTarget}
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
          onSuccess={() => {
            setDeleteTarget(null);
            queryClient.invalidateQueries({
              queryKey: entityKeys.all(entity.viewTable ?? entity.table),
            });
            queryClient.invalidateQueries({
              queryKey: entityKeys.all(entity.table),
            });
          }}
        />
      )}
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
                  <Skeleton className="h-4 w-full" style={{ animationDelay: `${i * 75}ms` }} />
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
