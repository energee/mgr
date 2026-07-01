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
 * - Data is fetched from Supabase with filters, search, sorting AND pagination
 *   applied server-side (manualFiltering/manualSorting/manualPagination):
 *   - "paged" mode (desktop table): `.order()` + `.range()` per page
 *   - "mobile" mode: `.range(0, n*pageSize-1)` accumulating pages via "Load more"
 *   - "board" mode (kanban): unpaginated but capped at KANBAN_FETCH_CAP rows,
 *     since the board groups the full filtered dataset by state
 * - Column projection: the select list is derived from entity config when
 *   provably safe; falls back to "*" when custom renderers/action predicates
 *   may read arbitrary row fields (see buildSelectList)
 * - State transitions (row actions, kanban drag, mobile card menu) update the
 *   paged-list cache optimistically with rollback on failure, guarded by a
 *   state-conditioned UPDATE instead of a pre-SELECT (see handleSingleTransition).
 *   All of these routes go through requestTransition, which opens the
 *   pre-transition fields dialog (EntityActionDef.transitionFields) when the
 *   target state's action declares one, merging the collected values into
 *   the same UPDATE as the status flip
 * - Mobile: card list (EntityMobileCardList) with a toolbar exposing search
 *   plus the same filter/sort controls in a bottom sheet (MobileFilterSheet);
 *   coarse-pointer devices (tablets keep the desktop table) get enlarged
 *   touch targets via useIsTouch
 * - Bulk operations: row selection is enabled for any bulk-capable entity
 *   (stateMachine and/or delete action) and is keyed by record id (getRowId)
 *   so it survives pagination; an id→row snapshot map
 *   (syncSelectionSnapshots) keeps off-page selected rows available to the
 *   bulk bar. The bar offers status transitions (server-revalidated by id)
 *   and bulk delete (EntityBulkDeleteDialog with per-row failure reporting)
 */

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  ColumnDef,
  SortingState,
  PaginationState,
  RowSelectionState,
  VisibilityState,
} from "@tanstack/react-table";
import { useReactTable, getCoreRowModel } from "@tanstack/react-table";
import { usePersistedPageSize } from "@/hooks/use-persisted-page-size";
import { useQuery, useQueryClient, keepPreviousData, type QueryKey } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { parseAsStringEnum } from "nuqs";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom } from "@/services/types";
import { runTransitionSideEffects } from "@/services/transition-side-effects";
import { entityKeys } from "@/lib/query-keys";
import { parsePostgresError } from "@/lib/errors";
import { CACHE_DURATIONS } from "@/lib/constants";
import type { EntityConfig, EntityActionDef } from "@/types/entity";
import { getStateLabel, getTransitionFieldsAction, entityRegistry } from "@/types/entity";
import type { EntityColumnDef } from "@/types/entity";
import type { ExtendedColumnFilter } from "@/types/data-table";
import { getFiltersStateParser } from "@/lib/parsers";
import { EntityErrorBoundary } from "./entity-error-boundary";
import { EntityKanban } from "@/components/universal/entity-kanban";
import { EntityDeleteDialog, EntityBulkDeleteDialog } from "./entity-delete-dialog";
import { getApplicableActions } from "@/lib/entity-actions";
import { EntityActionConfirmDialog } from "./entity-action-confirm-dialog";
import { EntityTransitionFieldsDialog } from "./entity-transition-fields-dialog";
import { BulkStatusActionBar } from "./bulk-status-action-bar";
import {
  buildDataTableColumns,
  buildSelectColumn,
  buildActionsColumn,
  buildSupabaseFiltersFromUrl,
  escapePostgrestOrValue,
  REL_KEY_PREFIX,
} from "@/components/data-table/adapter";
import { useDynamicFilterOptions } from "@/hooks/use-dynamic-filter-options";
import { useDebouncedCallback } from "@/hooks/use-debounced-callback";
import { useKeyboardShortcuts, type KeyboardShortcut } from "@/hooks/use-keyboard-shortcuts";
import { useIsMobile, useIsTouch } from "@/hooks/use-mobile";
import { generateId } from "@/lib/id";
import { EntityMobileCardList } from "./entity-mobile-card-list";
import { MobileFilterSheet } from "./entity-mobile-filter-sheet";

import { DataTable } from "@/components/data-table/data-table";
import { DataTableAdvancedToolbar } from "@/components/data-table/data-table-advanced-toolbar";
import { DataTableFilterList } from "@/components/data-table/data-table-filter-list";
import { DataTableSortList } from "@/components/data-table/data-table-sort-list";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  Inbox,
  LayoutList,
  Kanban as KanbanIcon,
} from "lucide-react";
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
  /** Default page size (overrides global default of 10) */
  defaultPageSize?: number;
}

// =============================================================================
// Server-fetch helpers
// =============================================================================

/**
 * Safety cap for the unpaginated kanban/board fetch. The board needs the full
 * filtered dataset (cards are grouped by state), so it cannot use `.range()`;
 * this cap prevents an unbounded fetch on very large tables.
 */
const KANBAN_FETCH_CAP = 1000;

/**
 * Column ids the entity config provably places on the fetched table/view:
 * `id` ∪ listColumns ∪ listFilters ∪ defaultSort ∪ quickFilter sort columns.
 * Shared core for the safe ORDER BY targets (orderableColumnIds) and the
 * select-list projection (buildSelectList, which extends it).
 */
function configColumnIds<T>(entity: EntityConfig<T>): Set<string> {
  const ids = new Set<string>(["id"]);
  for (const c of entity.listColumns) {
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
function buildSelectList<T>(
  entity: EntityConfig<T>,
  propFilters: Record<string, unknown> | undefined,
  hasOnAction: boolean
): string {
  if (hasOnAction) return "*";
  if (entity.listColumns.some((c) => c.render)) return "*";
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
 * Reconcile the id→row snapshot map backing cross-page row selection and
 * return the selected rows. Selection is keyed by record id (getRowId) so it
 * survives pagination, but off-page rows leave the fetched page while the
 * bulk bar still derives transition options and delete eligibility from row
 * data — so every selected row's last-seen snapshot is retained as pages
 * stream through:
 * - rows on the current page refresh their snapshot (latest server data)
 * - ids no longer selected are dropped
 * - selected ids whose row has paged out keep their last-seen snapshot
 * Exported for tests.
 */
export function syncSelectionSnapshots<T>(
  snapshots: Map<string, T>,
  rowSelection: RowSelectionState,
  rows: T[]
): T[] {
  const selectedIds = new Set(
    Object.entries(rowSelection)
      .filter(([, selected]) => selected)
      .map(([id]) => id)
  );
  for (const row of rows) {
    const id = String((row as Record<string, unknown>).id);
    if (selectedIds.has(id)) snapshots.set(id, row);
  }
  for (const id of [...snapshots.keys()]) {
    if (!selectedIds.has(id)) snapshots.delete(id);
  }
  return [...selectedIds]
    .map((id) => snapshots.get(id))
    .filter((r): r is T => r !== undefined);
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
  defaultPageSize,
}: EntityDataTableProps<T>) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const path = basePath || `/${entity.domain}/${entity.table}`;
  const router = useRouter();
  const [deleteTarget, setDeleteTarget] = useState<{ record: T; action: EntityActionDef<T> } | null>(null);
  // Action awaiting user confirmation (EntityActionDef.confirm) or its
  // pre-transition fields dialog (EntityActionDef.transitionFields) from the
  // row menu, mobile card menu, or a routed bare transition (kanban drag) —
  // dispatched by executeConfirmedAction below. Which dialog renders is
  // decided at render time by the action's `transitionFields`.
  const [confirmTarget, setConfirmTarget] = useState<{ record: T; action: EntityActionDef<T> } | null>(null);

  const handleRowClick = useCallback(
    (row: T) => {
      const id = (row as Record<string, unknown>).id;
      if (id) router.push(`${path}/${id}`);
    },
    [path, router],
  );

  const isMobile = useIsMobile();
  const isTouch = useIsTouch();
  // Bulk-capable surfaces: status transitions (stateMachine) and bulk delete
  // (delete action). Selection is enabled whenever either exists — not just
  // for stateMachine entities (audit finding 08).
  const bulkDeleteAction = entity.actions?.find(
    (a) => a.name === "delete" && a.deleteMode
  );
  const hasBulkActions = !!entity.stateMachine || !!bulkDeleteAction;
  const fetchTable = entity.viewTable || entity.table;

  // ---------------------------------------------------------------------------
  // Single item state transition (used by kanban drag-and-drop, row actions,
  // and the mobile card action menu)
  // ---------------------------------------------------------------------------

  /** Cache shape of the paged list query (see queryFn below). */
  type PagedListData = { rows: T[]; totalCount: number | null };

  // Latest paged-list query key. Assigned each render (right where the key is
  // built, below) so this handler — which must be defined before the query to
  // be usable in the columns memo — can target the active cache entry.
  const listQueryKeyRef = useRef<QueryKey | null>(null);

  /**
   * Transition a single record to `toState`, optimistically flipping the row
   * in the paged-list cache (rolled back on failure) so the UI updates without
   * waiting for a refetch (audit 10.4). No pre-SELECT: the row's current state
   * is read from the page cache, and the UPDATE is guarded by a WHERE on that
   * state (`.in(validFromStates)` when the row isn't cached) so a concurrent
   * change by another user matches 0 rows instead of clobbering.
   *
   * `extraFields` carries values collected by EntityTransitionFieldsDialog
   * (EntityActionDef.transitionFields) — written in the same UPDATE as the
   * status flip. Use requestTransition (below) for user-initiated bare
   * transitions so the fields dialog is never skipped.
   */
  const handleSingleTransition = useCallback(
    async (id: string, toState: string, extraFields?: Record<string, unknown>) => {
      if (!entity.stateMachine) return;

      const stateField = entity.stateMachine.stateField as string;
      const transitions = entity.stateMachine.transitions;

      // Source states from which `toState` is reachable (server-side guard
      // when the row's current state isn't in the cache)
      const validFromStates = Object.keys(transitions).filter((s) =>
        transitions[s]?.includes(toState)
      );

      const listKey = listQueryKeyRef.current;
      const cachedRow = (listKey
        ? queryClient.getQueryData<PagedListData>(listKey)?.rows
        : undefined
      )?.find((r) => (r as Record<string, unknown>).id === id) as
        | Record<string, unknown>
        | undefined;
      const currentState = cachedRow?.[stateField] as string | undefined;

      if (
        validFromStates.length === 0 ||
        (currentState && !transitions[currentState]?.includes(toState))
      ) {
        toast.error("Transition no longer valid — status may have changed");
        queryClient.invalidateQueries({ queryKey: entityKeys.all(fetchTable) });
        return;
      }

      // Optimistic update: flip the row's state in the page cache immediately
      let previous: PagedListData | undefined;
      if (listKey && cachedRow) {
        await queryClient.cancelQueries({ queryKey: listKey });
        previous = queryClient.getQueryData<PagedListData>(listKey);
        queryClient.setQueryData<PagedListData>(listKey, (old) =>
          old
            ? {
                ...old,
                rows: old.rows.map((r) =>
                  (r as Record<string, unknown>).id === id
                    ? ({ ...r, ...extraFields, [stateField]: toState } as T)
                    : r
                ),
              }
            : old
        );
      }
      const rollback = () => {
        if (listKey && previous) queryClient.setQueryData(listKey, previous);
      };

      // State-guarded UPDATE — 0 rows affected means another user changed the
      // state between render and click (race guard without a pre-SELECT)
      let update = dynamicFrom(supabase, entity.table)
        .update({ ...extraFields, [stateField]: toState })
        .eq("id", id);
      update = currentState
        ? update.eq(stateField, currentState)
        : update.in(stateField, validFromStates);
      const { data: updated, error } = await update.select("id");

      if (error) {
        rollback();
        // Friendly translation of DB-level failures — e.g. keg_transactions
        // state checks surface their CONSTRAINT_MESSAGES entry instead of a
        // generic failure (src/lib/errors.ts)
        toast.error(parsePostgresError(error));
        return;
      }
      if (!updated || updated.length === 0) {
        rollback();
        toast.error("Transition no longer valid — status may have changed");
        queryClient.invalidateQueries({ queryKey: entityKeys.all(fetchTable) });
        return;
      }

      toast.success(`Status updated to ${getStateLabel(entity, toState)}`);

      // Post-transition side effects (e.g. completing a batch also confirms
      // its planned ingredient consumption) live in the shared registry in
      // services/transition-side-effects.ts so every transition path runs
      // them. Fire-and-forget: the status update already succeeded, so only
      // surface side-effect failures.
      void runTransitionSideEffects(supabase, entity.table, [id], toState).then(
        ({ error: sideEffectError }) => {
          if (sideEffectError) toast.error(sideEffectError);
        }
      );

      // Background reconcile — the row may now fall outside active filters or
      // belong on another page; the optimistic row keeps the UI instant.
      queryClient.invalidateQueries({
        queryKey: entityKeys.all(fetchTable),
      });
      if (entity.viewTable) {
        queryClient.invalidateQueries({
          queryKey: entityKeys.all(entity.table),
        });
      }
    },
    [entity, supabase, queryClient, fetchTable],
  );

  /**
   * Route a bare transition request (row menu, kanban drag, mobile card
   * menu) through the pre-transition fields dialog when an action declares
   * `transitionFields` for the target state; otherwise transition
   * immediately. This is the onTransition handler handed to every list
   * surface so none of them can bare-flip past the dialog. The pending
   * record is read from the page cache (same listQueryKeyRef pattern as
   * handleSingleTransition) so field defaults can derive from it.
   */
  const requestTransition = useCallback(
    async (id: string, toState: string) => {
      const fieldsAction = getTransitionFieldsAction(entity, toState);
      if (!fieldsAction) {
        return handleSingleTransition(id, toState);
      }
      const listKey = listQueryKeyRef.current;
      const cachedRow = (listKey
        ? queryClient.getQueryData<PagedListData>(listKey)?.rows
        : undefined
      )?.find((r) => (r as Record<string, unknown>).id === id);
      setConfirmTarget({
        record: (cachedRow ?? ({ id } as Record<string, unknown>)) as T,
        action: fieldsAction,
      });
    },
    [entity, queryClient, handleSingleTransition],
  );

  /**
   * Dispatch a confirm-gated action after the user accepts the shared
   * EntityActionConfirmDialog, or a transition-fields action after its
   * dialog submits (`extraFields` = the collected values, merged into the
   * status UPDATE). Mirrors the post-confirm portion of the row menu's
   * onClick in adapter.tsx buildActionsColumn: onAction override first,
   * then state transition or custom handler.
   */
  const executeConfirmedAction = useCallback((extraFields?: Record<string, unknown>) => {
    if (!confirmTarget) return;
    const { record, action } = confirmTarget;
    setConfirmTarget(null);
    if (onAction && onAction(action.name, record)) return;
    if (action.toState) {
      const id = (record as Record<string, unknown>).id as string;
      void handleSingleTransition(id, action.toState, extraFields);
      return;
    }
    void action.handler?.(record);
  }, [confirmTarget, onAction, handleSingleTransition]);

  // ---------------------------------------------------------------------------
  // View mode (table vs board)
  // ---------------------------------------------------------------------------
  const [viewMode, setViewMode] = useQueryState(
    "view",
    parseAsStringEnum(["table", "board"]).withDefault("table")
  );

  /**
   * Fetch mode decides how the list query is windowed:
   * - "board": full filtered dataset (capped) — kanban groups rows by state
   * - "mobile": pages 0..N accumulated for the card list's "Load more"
   * - "paged": one server page per pageIndex/pageSize
   */
  const isBoardView = viewMode === "board" && !!entity.kanbanConfig;
  const fetchMode: "paged" | "mobile" | "board" = isBoardView
    ? "board"
    : isMobile
      ? "mobile"
      : "paged";

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
  // Debounced search value (the input itself lives in ListSearchInput so
  // per-keystroke re-renders don't re-render the whole table)
  const [debouncedSearch, setDebouncedSearch] = useState("");
  // Keyed by record id (getRowId below), so selection survives page flips
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  // Multi-record delete confirmation (EntityBulkDeleteDialog) visibility
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // Persisted page size (per-entity defaultPageSize overrides the global default)
  const { pageSize: persistedPageSize, setPageSize: setPersistedPageSize } =
    usePersistedPageSize(defaultPageSize);
  const [pagination, setPagination] = useState<PaginationState>(() => ({
    pageIndex: 0,
    pageSize: defaultPageSize ?? persistedPageSize,
  }));
  // Number of server pages accumulated by the mobile card list's "Load more"
  const [mobilePages, setMobilePages] = useState(1);

  // Reset when navigating between entities (search input remounts via key)
  useEffect(() => {
    setDebouncedSearch("");
    setRowSelection({});
    setMobilePages(1);
    setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 }));
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
      // requestTransition (not handleSingleTransition) so transitions whose
      // action declares transitionFields open the fields dialog first
      requestTransition,
      (record, action) => setDeleteTarget({ record, action }),
      (record, action) => setConfirmTarget({ record, action })
    );

    if (hasBulkActions) {
      return [buildSelectColumn<T>(), ...dataColumns, actionsColumn];
    }
    return [...dataColumns, actionsColumn];
  }, [entity, dynamicFilterOptions, path, onAction, hasBulkActions, requestTransition]);

  // Hide filter-only columns (filters whose field doesn't match any listColumn accessorKey)
  const columnVisibility = useMemo((): VisibilityState => {
    const listColumnKeys = new Set(
      entity.listColumns.map((c) => (c.accessorKey as string) || c.id).filter(Boolean)
    );
    const vis: VisibilityState = {};
    for (const filter of entity.listFilters ?? []) {
      if (!listColumnKeys.has(filter.field)) {
        vis[filter.field] = false;
      }
    }
    return vis;
  }, [entity.listColumns, entity.listFilters]);

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

  // Reset row selection and pagination when filters or search change — with
  // server pagination a stale pageIndex would show an empty page, and rows
  // selected under the old criteria may not appear anywhere in the new result
  // set (selection itself is id-keyed and survives page flips, so there is
  // deliberately NO reset on pageIndex changes). JSON key avoids re-runs from
  // unstable array/object identities.
  const filterResetKey = JSON.stringify({ urlFilters, debouncedSearch, filters });
  useEffect(() => {
    setRowSelection({});
    setMobilePages(1);
    setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 }));
  }, [filterResetKey]);

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
  const hasAppliedDefault = useRef(false);
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

  // Columns known to exist on the fetched table/view (the config renders/filters
  // them), i.e. safe targets for a server-side ORDER BY.
  const orderableColumnIds = useMemo(() => configColumnIds(entity), [entity]);

  // Server-side ORDER BY derived from TanStack sorting state. Falls back to
  // the entity's defaultSort, and always appends a unique `id` tiebreaker so
  // `.range()` pages never overlap or skip rows when the sort column has ties.
  const orderSpec = useMemo(() => {
    const orders = sorting
      .filter((s) => orderableColumnIds.has(s.id))
      .map((s) => ({ column: s.id, ascending: !s.desc }));
    if (orders.length === 0 && entity.defaultSort) {
      orders.push({
        column: entity.defaultSort.column,
        ascending: entity.defaultSort.direction === "asc",
      });
    }
    if (!orders.some((o) => o.column === "id")) {
      orders.push({ column: "id", ascending: true });
    }
    return orders;
  }, [sorting, orderableColumnIds, entity.defaultSort]);

  // Column projection — board view always fetches "*" (kanban card renderers
  // may read arbitrary fields); see buildSelectList for the safety rules.
  const selectList = useMemo(
    () => (isBoardView ? "*" : buildSelectList(entity, filters, !!onAction)),
    [entity, filters, onAction, isBoardView]
  );

  // Fetch window for the current mode
  const rangeFrom = fetchMode === "paged" ? pagination.pageIndex * pagination.pageSize : 0;
  const rangeTo =
    fetchMode === "board"
      ? KANBAN_FETCH_CAP - 1
      : fetchMode === "mobile"
        ? mobilePages * pagination.pageSize - 1
        : rangeFrom + pagination.pageSize - 1;

  // Exact key of the active list query. Mirrored into listQueryKeyRef so
  // handleSingleTransition (defined above, before the query) can apply
  // optimistic updates to this cache entry at event time.
  const listQueryKey = entityKeys.pagedList(
    fetchTable,
    {
      ...filters,
      ...filterKey,
      search: debouncedSearch || undefined,
    },
    {
      mode: fetchMode,
      from: rangeFrom,
      to: rangeTo,
      order: orderSpec,
      select: selectList,
    }
  );
  listQueryKeyRef.current = listQueryKey;

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: listQueryKey,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
    // Keep showing the previous page while the next one loads (no flash on
    // page/sort/filter changes) — but never across different tables, so an
    // entity switch within the same component instance shows the skeleton
    // instead of the previous entity's rows.
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[0] === fetchTable ? keepPreviousData(previousData) : undefined,
    queryFn: async () => {
      let query = dynamicFrom(supabase, fetchTable).select(selectList, {
        count: "estimated",
      });

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

      // Server-side sort + fetch window (see fetchMode comment above).
      // Board mode is unpaginated (kanban needs the full filtered dataset)
      // but capped as a safety valve.
      for (const o of orderSpec) {
        query = query.order(o.column, { ascending: o.ascending });
      }
      query = query.range(rangeFrom, rangeTo);

      const { data, error, count } = await query;
      if (error) throw error;
      const rows = (data ?? []) as Record<string, unknown>[];

      // Batch-resolve FK relation columns (parallel, one query per relation table)
      const relationCols = entity.listColumns.filter(
        (c: EntityColumnDef<T>) => c.relation && c.accessorKey
      );
      await Promise.allSettled(relationCols.map(async (col) => {
        const key = col.accessorKey as string;
        const uniqueIds = [...new Set(rows.map((r) => r[key]).filter(Boolean))] as string[];
        if (uniqueIds.length === 0) return;

        const relEntity = entityRegistry.get(col.relation!.entity);
        const table = relEntity?.table ?? `${col.relation!.entity}s`;
        const displayField = col.relation!.displayField;

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
      }));

      return { rows: rows as T[], totalCount: count as number | null };
    },
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const totalCount = data?.totalCount ?? null;

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
    data: rows,
    columns,
    // Row identity = record id (not the default page-positional index) so
    // rowSelection keys are ids and selection survives pagination
    getRowId: (row) => String((row as Record<string, unknown>).id),
    state: {
      sorting,
      pagination,
      columnVisibility,
      ...(hasBulkActions ? { rowSelection } : {}),
    },
    onSortingChange: setSorting,
    onPaginationChange: handlePaginationChange,
    ...(hasBulkActions
      ? { onRowSelectionChange: setRowSelection, enableRowSelection: true }
      : {}),
    getCoreRowModel: getCoreRowModel(),
    // Filtering, sorting and pagination all happen server-side in the queryFn
    manualFiltering: true,
    manualSorting: true,
    manualPagination: true,
    pageCount:
      totalCount != null
        ? Math.max(1, Math.ceil(totalCount / pagination.pageSize))
        : -1,
    rowCount: totalCount ?? undefined,
  });

  // ---------------------------------------------------------------------------
  // Bulk action helpers
  // ---------------------------------------------------------------------------
  // Row selection keys are record ids (getRowId). The ref holds the last-seen
  // snapshot of every selected row so rows selected on other pages remain
  // available to the bulk bar (see syncSelectionSnapshots). The memo body
  // mutates the ref map, which is safe: the reconciliation is idempotent and
  // re-runs whenever selection or the fetched page changes.
  const selectionSnapshotsRef = useRef(new Map<string, T>());
  const selectedRows = useMemo(
    () =>
      syncSelectionSnapshots(selectionSnapshotsRef.current, rowSelection, rows),
    [rowSelection, rows]
  );

  // Selected rows the delete action actually applies to — same per-row
  // visibility rules as the row/card menus (getApplicableActions: showWhen,
  // fromStates) plus disabledWhen, evaluated against the row snapshots. The
  // bulk bar surfaces the count when it's a strict subset of the selection.
  const bulkDeletableRows = useMemo(() => {
    if (!bulkDeleteAction) return [];
    return selectedRows.filter(
      (row) =>
        getApplicableActions(entity, row).some(
          (a) => a.name === bulkDeleteAction.name
        ) && !bulkDeleteAction.disabledWhen?.(row)
    );
  }, [bulkDeleteAction, entity, selectedRows]);

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

      // Backstop for stateMachine.requiresAction targets and
      // transition-fields actions: the bulk bar already disables
      // requiresAction options, but never bare-UPDATE into a state whose
      // transition is owned by a named action's interactive flow (e.g. the
      // schedule dialog capturing scheduled_date — bulk can't collect
      // per-record fields).
      const requiredActionName = entity.stateMachine.requiresAction?.[targetStatus];
      const fieldsAction = getTransitionFieldsAction(entity, targetStatus);
      if (requiredActionName || fieldsAction) {
        const requiredAction = requiredActionName
          ? entity.actions?.find((a) => a.name === requiredActionName)
          : fieldsAction;
        toast.error(
          `Use the ${requiredAction?.label ?? requiredActionName} action on each ${entity.displayName.toLowerCase()} instead`
        );
        return 0;
      }

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

      // Post-transition side effects for the rows that actually transitioned
      // (see services/transition-side-effects.ts). Fire-and-forget: the bulk
      // update already succeeded, so only surface side-effect failures.
      void runTransitionSideEffects(supabase, entity.table, validIds, targetStatus).then(
        ({ error: sideEffectError }) => {
          if (sideEffectError) toast.error(sideEffectError);
        }
      );

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
      <div className="flex flex-col items-center gap-3 py-8">
        <p className="text-destructive">
          Failed to load {entity.displayNamePlural.toLowerCase()}
        </p>
        <Button onClick={() => refetch()}>Try Again</Button>
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
              {/* Touch devices get ≥40px hit areas (audit 10.1) */}
              <Button
                variant={viewMode === "table" ? "secondary" : "ghost"}
                size="icon-xs"
                className={cn(isTouch && "size-10")}
                onClick={() => setViewMode("table")}
                aria-label="Table view"
                aria-pressed={viewMode === "table"}
              >
                <LayoutList className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant={viewMode === "board" ? "secondary" : "ghost"}
                size="icon-xs"
                className={cn(isTouch && "size-10")}
                onClick={() => setViewMode("board")}
                aria-label="Board view"
                aria-pressed={viewMode === "board"}
              >
                <KanbanIcon className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          {showCreate && (
            <Button
              variant="ghost"
              size="sm"
              className={cn(isTouch && "h-10 px-3")}
              asChild={!onCreateClick}
              onClick={onCreateClick}
            >
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
        ) : isBoardView ? (
          <>
            <EntityKanban
              entity={entity}
              data={rows}
              basePath={path}
              onTransition={requestTransition}
            />
            {/* Board fetches are capped at KANBAN_FETCH_CAP — tell the user
                when the cap truncated the dataset instead of failing silently */}
            {totalCount != null && totalCount > rows.length && (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing first {rows.length.toLocaleString()} of{" "}
                {totalCount.toLocaleString()} — narrow filters to see all
              </p>
            )}
          </>
        ) : fetchMode === "mobile" ? (
          <>
            {/* Mobile toolbar: search + filter/sort sheet (audit 10.3) */}
            <div className="mb-3 flex items-center gap-2">
              {entity.searchableFields && entity.searchableFields.length > 0 && (
                <ListSearchInput
                  key={entity.name}
                  variant="mobile"
                  isTouch={isTouch}
                  placeholder={`Search ${entity.displayNamePlural.toLowerCase()}...`}
                  onDebouncedChange={setDebouncedSearch}
                />
              )}
              <MobileFilterSheet
                table={table}
                activeFilterCount={urlFilters.length}
              />
            </div>
            <EntityMobileCardList
              entity={entity as EntityConfig<Record<string, unknown>>}
              data={rows as Record<string, unknown>[]}
              basePath={path}
              showCreate={showCreate}
              onCreateClick={onCreateClick}
              hasActiveFilters={!!hasActiveFilters}
              hasMore={totalCount != null && rows.length < totalCount}
              isLoadingMore={isFetching}
              onLoadMore={() => setMobilePages((n) => n + 1)}
              onTransition={requestTransition}
              onAction={
                onAction as
                  | ((actionName: string, record: Record<string, unknown>) => boolean)
                  | undefined
              }
              onDeleteAction={(record, action) =>
                setDeleteTarget({
                  record: record as T,
                  action: action as EntityActionDef<T>,
                })
              }
              onConfirmAction={(record, action) =>
                setConfirmTarget({
                  record: record as T,
                  action: action as EntityActionDef<T>,
                })
              }
            />
          </>
        ) : (
          <DataTable
            table={table}
            // Touch ergonomics (audit 10.1): tablets ≥768px keep the desktop
            // table but get taller rows and ≥40px hit areas on row buttons
            // (e.g. the actions menu trigger) when the pointer is coarse.
            className={cn(
              isTouch &&
                "[&_td]:py-3 [&_th]:h-10 [&_td_button]:min-h-10 [&_td_button]:min-w-10"
            )}
            onRowClick={handleRowClick}
            actionBar={
              // Show the bar when the selection has something actionable:
              // a common status transition and/or deletable rows
              selectedRows.length > 0 &&
              (hasValidBulkTransitions || bulkDeletableRows.length > 0) ? (
                <BulkStatusActionBar
                  entity={entity}
                  selectedRows={selectedRows}
                  onStatusChange={handleBulkStatusChange}
                  onClearSelection={() => setRowSelection({})}
                  onBulkDelete={
                    bulkDeletableRows.length > 0
                      ? () => setBulkDeleteOpen(true)
                      : undefined
                  }
                  bulkDeleteCount={bulkDeletableRows.length}
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
                  <ListSearchInput
                    key={entity.name}
                    variant="toolbar"
                    isTouch={isTouch}
                    placeholder={`Search ${entity.displayNamePlural.toLowerCase()}...`}
                    onDebouncedChange={setDebouncedSearch}
                  />
                )}
              <DataTableFilterList table={table} />
              <DataTableSortList table={table} />
            </DataTableAdvancedToolbar>
          </DataTable>
        )}
      </div>

      {/* Action Confirmation / Pre-Transition Fields Dialog — shared by the
          desktop row menu, mobile card menu, and kanban drag. Actions with
          transitionFields get the fields dialog (which doubles as the
          confirm step); plain confirm actions get the confirm dialog. */}
      {confirmTarget &&
        (confirmTarget.action.transitionFields?.length ? (
          <EntityTransitionFieldsDialog
            actionLabel={confirmTarget.action.label}
            recordTitle={String(
              (confirmTarget.record as Record<string, unknown>)[
                entity.detailHeader?.title ?? "name"
              ] ?? entity.displayName
            )}
            fields={confirmTarget.action.transitionFields}
            record={confirmTarget.record}
            open={!!confirmTarget}
            onOpenChange={(open) => {
              if (!open) {
                setConfirmTarget(null);
                // Kanban moves the card optimistically during drag — refetch
                // so a cancelled dialog snaps it back to its real column.
                if (isBoardView) {
                  queryClient.invalidateQueries({
                    queryKey: entityKeys.all(fetchTable),
                  });
                }
              }
            }}
            onSubmit={(values) => executeConfirmedAction(values)}
          />
        ) : (
          <EntityActionConfirmDialog
            actionLabel={confirmTarget.action.label}
            recordTitle={String(
              (confirmTarget.record as Record<string, unknown>)[
                entity.detailHeader?.title ?? "name"
              ] ?? entity.displayName
            )}
            destructive={confirmTarget.action.variant === "destructive"}
            open={!!confirmTarget}
            onOpenChange={(open) => { if (!open) setConfirmTarget(null); }}
            onConfirm={() => executeConfirmedAction()}
          />
        ))}

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

      {/* Bulk Delete Dialog — multi-record variant with per-row failure
          reporting. onDeleted also fires on partial success, dropping the
          deleted ids from the id-keyed selection so the records prop shrinks
          to the failed rows (a retry only retries those). */}
      {bulkDeleteAction?.deleteMode && (
        <EntityBulkDeleteDialog
          entityTable={entity.table}
          entityDisplayName={entity.displayName}
          entityDisplayNamePlural={entity.displayNamePlural}
          records={bulkDeletableRows.map((row) => {
            const rec = row as Record<string, unknown>;
            return {
              id: String(rec.id),
              title: String(
                rec[entity.detailHeader?.title ?? "name"] ?? entity.displayName
              ),
            };
          })}
          deleteMode={bulkDeleteAction.deleteMode}
          open={bulkDeleteOpen}
          onOpenChange={setBulkDeleteOpen}
          onDeleted={(deletedIds) => {
            setRowSelection((prev) => {
              const next = { ...prev };
              for (const id of deletedIds) delete next[id];
              return next;
            });
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
// ListSearchInput
// =============================================================================

/**
 * Search input that owns its keystroke state locally and only notifies the
 * parent with a debounced value, so typing doesn't re-render the whole table
 * (audit plan item [d]). Remount via `key={entity.name}` clears it when
 * navigating between entities. `isTouch` bumps the input to h-9 so the tap
 * target is comfortable on coarse-pointer devices (audit 10.1).
 */
function ListSearchInput({
  placeholder,
  onDebouncedChange,
  variant,
  isTouch,
}: {
  placeholder: string;
  onDebouncedChange: (value: string) => void;
  variant: "mobile" | "toolbar";
  isTouch?: boolean;
}) {
  const [value, setValue] = useState("");
  const debouncedNotify = useDebouncedCallback(onDebouncedChange, 300);

  const handleChange = (next: string) => {
    setValue(next);
    debouncedNotify(next);
  };

  if (variant === "mobile") {
    return (
      <div className="relative flex-1">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder={placeholder}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          className={cn("pl-8 text-sm", isTouch ? "h-9" : "h-8")}
        />
      </div>
    );
  }

  return (
    <div className="relative w-full sm:w-auto sm:min-w-[220px] sm:max-w-sm">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        className={cn(
          "pl-8 pr-8 border-transparent bg-transparent focus-visible:border-border focus-visible:bg-background",
          isTouch ? "h-9 text-sm" : "h-7 text-xs"
        )}
      />
      {!value && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true">
          <Kbd>/</Kbd>
        </div>
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
// Re-exports — canonical hub is entity-list.tsx
// =============================================================================

export type EntityListProps<T = Record<string, unknown>> =
  EntityDataTableProps<T>;

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

