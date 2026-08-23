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
 * - Sorting is URL-synced via nuqs (audit F-082); DataTableSortList reads/writes via table
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
