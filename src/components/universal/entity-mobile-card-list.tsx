"use client";

/**
 * EntityMobileCardList - Mobile card layout for entity list pages.
 *
 * Renders entity rows as tappable cards below the md breakpoint.
 * The card heading is the entity's detailHeader.title field with a
 * StatusBadge when the entity has a stateMachine. The first three
 * non-title/non-status listColumns render as the always-visible
 * summary; any remaining listColumns are progressively disclosed
 * by a per-card "Show more" toggle (audit F-085).
 *
 * Rows are server-paginated by the parent (entity-data-table); when
 * more rows exist a "Load more" button asks the parent to widen the
 * fetch window (audit 4.3).
 *
 * Each card gets a trailing three-dot menu (≥40px hit area) exposing
 * the record's applicable entity actions — state transitions and
 * custom/button actions, filtered by the same getApplicableActions
 * helper (lib/entity-actions) as the desktop actions column
 * (audit 10.2). Transitions are dispatched
 * through the parent's handleSingleTransition so the optimistic
 * cache update + race guard are shared, not duplicated.
 *
 * Expanded state is held at the list level (Set<rowId>) so it
 * survives parent re-renders triggered by parallel mutations or
 * filter updates. It is intentionally not persisted across
 * navigation — entering a detail page and returning resets the
 * cards to their collapsed summary view.
 */

import Link from "next/link";
import { useMemo, useState, useCallback, type ReactNode } from "react";
import type { EntityConfig, EntityColumnDef, EntityActionDef } from "@/types/entity";
import { StatusBadge } from "@/components/universal/status-badge";
import { AnimatedActionMenuItem } from "@/components/universal/animated-action-menu-item";
import { formatValue } from "@/lib/utils";
import { getApplicableActions } from "@/lib/entity-actions";
import { UnitDisplay } from "@/components/ui/unit-input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, Inbox, ChevronDown, MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";

type EntityMobileCardListProps = {
  /** Entity configuration */
  entity: EntityConfig<Record<string, unknown>>;
  /** Data rows to render */
  data: Record<string, unknown>[];
  /** Base path for detail page links */
  basePath: string;
  /** Whether to show create button in empty state */
  showCreate?: boolean;
  /** Custom create handler */
  onCreateClick?: () => void;
  /** Whether there are active search/filter criteria */
  hasActiveFilters: boolean;
  /** Whether more rows exist on the server beyond those currently loaded */
  hasMore?: boolean;
  /** Whether the next page is currently being fetched */
  isLoadingMore?: boolean;
  /** Fetch the next page of rows (server pagination "Load more") */
  onLoadMore?: () => void;
  /**
   * Fire a state transition for a record. Provided by entity-data-table's
   * handleSingleTransition so the optimistic cache update + race guard are
   * shared with the table/kanban views (audit 10.2).
   */
  onTransition?: (id: string, toState: string) => Promise<void>;
  /** Page-level action override — return true if handled externally */
  onAction?: (actionName: string, record: Record<string, unknown>) => boolean;
  /** Open the shared delete-confirmation dialog for a record */
  onDeleteAction?: (
    record: Record<string, unknown>,
    action: EntityActionDef<Record<string, unknown>>,
  ) => void;
  /**
   * Open the shared action-confirmation dialog (EntityActionDef.confirm)
   * for a record. Owned by entity-data-table (EntityActionConfirmDialog) so
   * the desktop row menu and mobile cards share one dialog + dispatch path.
   */
  onConfirmAction?: (
    record: Record<string, unknown>,
    action: EntityActionDef<Record<string, unknown>>,
  ) => void;
}

/**
 * Format a column value for display in a card subtitle row.
 * Handles custom render functions, unit formatting, and standard formats.
 */
function renderColumnValue(
  col: EntityColumnDef<Record<string, unknown>>,
  row: Record<string, unknown>,
): ReactNode {
  const key = col.accessorKey as string;
  const value = key ? row[key] : undefined;

  if (col.render) {
    return col.render(value, row);
  }

  if (col.format === "unit" && col.unitType) {
    return <UnitDisplay value={value as number | null} unitType={col.unitType} />;
  }

  return formatValue(value, col.format);
}

export function EntityMobileCardList({
  entity,
  data,
  basePath,
  showCreate,
  onCreateClick,
  hasActiveFilters,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onTransition,
  onAction,
  onDeleteAction,
  onConfirmAction,
}: EntityMobileCardListProps) {
  // ---- Determine which field to use as the card title ----
  const titleField =
    entity.detailHeader?.title ?? (entity.listColumns[0]?.accessorKey as string);

  // ---- Determine the status field if entity has a state machine ----
  const statusField = entity.stateMachine?.stateField as string | undefined;

  // ---- Pick summary vs detail columns ----
  // First 3 columns rendered always as the summary; remaining columns are
  // revealed by the per-card "Show more" toggle (audit F-085).
  const allColumns = useMemo(
    () =>
      entity.listColumns.filter((col) => {
        const key = col.accessorKey as string | undefined;
        if (!key) return false;
        if (key === titleField) return false;
        if (key === statusField) return false;
        return true;
      }),
    [entity.listColumns, titleField, statusField],
  );
  const summaryColumns = allColumns.slice(0, 3);
  const detailColumns = allColumns.slice(3);

  // ---- Parent-owned expand state ----
  // Holds the set of row ids whose detail columns are currently expanded.
  // Lifting state above the per-card component ensures it survives parent
  // re-renders (e.g. after a filter change re-runs the query and re-keys
  // unchanged rows).
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ---- Empty state ----
  if (data.length === 0) {
    return (
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
                No matching {entity.displayNamePlural.toLowerCase()}
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
                <Link href={`${basePath}/new`}>
                  Create {entity.displayName}
                </Link>
              </Button>
            )}
          </>
        )}
      </div>
    );
  }

  // ---- Card list ----
  return (
    <div className="flex flex-col gap-2">
      {data.map((row) => {
        const id = row.id as string;
        return (
          <EntityMobileCard
            key={id}
            row={row}
            entity={entity}
            basePath={basePath}
            titleField={titleField}
            statusField={statusField}
            summaryColumns={summaryColumns}
            detailColumns={detailColumns}
            expanded={expandedIds.has(id)}
            onToggle={toggleExpanded}
            onTransition={onTransition}
            onAction={onAction}
            onDeleteAction={onDeleteAction}
            onConfirmAction={onConfirmAction}
          />
        );
      })}
      {/* Server pagination: rows arrive one page at a time (audit 4.3) */}
      {hasMore && onLoadMore && (
        <Button
          variant="outline"
          size="sm"
          className="mt-1 min-h-[44px]"
          onClick={onLoadMore}
          disabled={isLoadingMore}
        >
          {isLoadingMore ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}

/**
 * Single mobile card. Splits into:
 * - Link region (tap anywhere on the title/summary navigates to the detail page).
 * - Optional three-dot actions menu, absolutely positioned over the top-right
 *   corner as a SIBLING of the `<Link>` (valid HTML — interactive content
 *   cannot nest inside `<a>`), with a ≥40px hit area (audit 10.2).
 * - Optional "Show more" toggle rendered as a sibling button BELOW the
 *   `<Link>`. Expanded state is owned by the parent list so it
 *   survives re-renders.
 */
function EntityMobileCard({
  row,
  entity,
  basePath,
  titleField,
  statusField,
  summaryColumns,
  detailColumns,
  expanded,
  onToggle,
  onTransition,
  onAction,
  onDeleteAction,
  onConfirmAction,
}: {
  row: Record<string, unknown>;
  entity: EntityConfig<Record<string, unknown>>;
  basePath: string;
  titleField: string;
  statusField: string | undefined;
  summaryColumns: EntityColumnDef<Record<string, unknown>>[];
  detailColumns: EntityColumnDef<Record<string, unknown>>[];
  expanded: boolean;
  onToggle: (id: string) => void;
  onTransition?: (id: string, toState: string) => Promise<void>;
  onAction?: (actionName: string, record: Record<string, unknown>) => boolean;
  onDeleteAction?: (
    record: Record<string, unknown>,
    action: EntityActionDef<Record<string, unknown>>,
  ) => void;
  onConfirmAction?: (
    record: Record<string, unknown>,
    action: EntityActionDef<Record<string, unknown>>,
  ) => void;
}) {
  const id = row.id as string;
  const title = row[titleField] ?? "Untitled";
  const statusValue = statusField ? (row[statusField] as string | undefined) : undefined;
  const hasExtras = detailColumns.length > 0;
  const extrasId = `card-extras-${id}`;
  const actions = getApplicableActions(entity, row);
  const hasMenu = actions.length > 0;

  return (
    <div className="relative rounded-lg border bg-card transition-colors active:bg-accent/50">
      <Link href={`${basePath}/${id}`} className="block p-3">
        {/* Header row: title + status badge (right padding reserves space
            for the absolutely-positioned actions menu) */}
        <div className={cn("flex items-center justify-between gap-2", hasMenu && "pr-9")}>
          <span className="font-medium text-sm truncate">{String(title)}</span>
          {statusValue && (
            <StatusBadge
              status={statusValue}
              config={entity.stateMachine?.stateDisplay}
            />
          )}
        </div>

        {/* Always-visible summary rows */}
        {summaryColumns.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            {summaryColumns.map((col) => {
              const key = col.accessorKey as string;
              return (
                <span key={key} className="truncate">
                  <span className="text-muted-foreground/60">
                    {typeof col.header === "string" ? col.header : key}:
                  </span>{" "}
                  {renderColumnValue(col, row)}
                </span>
              );
            })}
          </div>
        )}

        {/* Expanded detail rows */}
        {expanded && hasExtras && (
          <div
            id={extrasId}
            className="mt-2 pt-2 border-t flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground"
          >
            {detailColumns.map((col) => {
              const key = col.accessorKey as string;
              return (
                <span key={key} className="truncate">
                  <span className="text-muted-foreground/60">
                    {typeof col.header === "string" ? col.header : key}:
                  </span>{" "}
                  {renderColumnValue(col, row)}
                </span>
              );
            })}
          </div>
        )}
      </Link>

      {/* Actions menu — sibling of the Link (NOT nested), absolutely
          positioned over the card's top-right corner. stopPropagation keeps
          the tap from bubbling into ancestors with click handlers; since the
          button is not inside the <a>, it never triggers navigation. */}
      {hasMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0.5 top-0.5 size-10 text-muted-foreground"
              aria-label={`Actions for ${String(title)}`}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {actions.map((action) => {
              const disabledReason = action.disabledWhen?.(row);
              return (
                <AnimatedActionMenuItem
                  key={action.name}
                  icon={action.icon}
                  label={action.label}
                  variant={action.variant === "destructive" ? "destructive" : undefined}
                  disabled={!!disabledReason}
                  title={disabledReason || undefined}
                  onClick={() => {
                    if (disabledReason) return;
                    if (action.name === "delete" && action.deleteMode && onDeleteAction) {
                      onDeleteAction(row, action);
                      return;
                    }
                    // Confirm gate runs BEFORE the onAction override so
                    // page-intercepted actions are covered too.
                    if (action.confirm && onConfirmAction) {
                      onConfirmAction(row, action);
                      return;
                    }
                    if (onAction && onAction(action.name, row)) {
                      return;
                    }
                    if (action.toState && onTransition) {
                      void onTransition(id, action.toState);
                      return;
                    }
                    void action.handler?.(row);
                  }}
                />
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* "Show more" toggle — sibling of the Link (NOT nested) so the
          markup remains valid HTML. A ≥44×44 px tap target keeps it
          comfortably hittable on touch devices (WCAG 2.5.5). */}
      {hasExtras && (
        <button
          type="button"
          onClick={() => onToggle(id)}
          aria-expanded={expanded}
          aria-controls={extrasId}
          className="w-full px-3 py-2 min-h-[44px] border-t text-xs text-muted-foreground hover:bg-muted/50 flex items-center justify-center gap-1"
        >
          {expanded ? "Show less" : `Show ${detailColumns.length} more field${detailColumns.length === 1 ? "" : "s"}`}
          <ChevronDown
            className={cn(
              "h-3 w-3 transition-transform duration-150",
              expanded && "rotate-180",
            )}
          />
        </button>
      )}
    </div>
  );
}
