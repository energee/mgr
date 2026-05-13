/**
 * EntityMobileCardList - Mobile card layout for entity list pages.
 *
 * Renders entity rows as tappable cards below the md breakpoint.
 * Shows the first 3 listColumns from entity config, with the
 * detailHeader.title field as the card heading and a StatusBadge
 * when the entity has a stateMachine.
 */

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import type { EntityConfig, EntityColumnDef } from "@/types/entity";
import { StatusBadge } from "@/components/universal/status-badge";
import { formatValue } from "@/lib/utils";
import { UnitDisplay } from "@/components/ui/unit-input";
import { Button } from "@/components/ui/button";
import { Search, Inbox, ChevronDown } from "lucide-react";
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
}: EntityMobileCardListProps) {
  // ---- Determine which field to use as the card title ----
  const titleField =
    entity.detailHeader?.title ?? (entity.listColumns[0]?.accessorKey as string);

  // ---- Determine the status field if entity has a state machine ----
  const statusField = entity.stateMachine?.stateField as string | undefined;

  // ---- Pick subtitle columns ----
  // First 3 columns rendered always; remaining columns are revealed by the
  // per-card "More" toggle (audit F-085).
  const allSubtitleColumns = useMemo(
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
  const subtitleColumns = allSubtitleColumns.slice(0, 3);
  const extraColumns = allSubtitleColumns.slice(3);

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
      {data.map((row) => (
        <EntityMobileCard
          key={row.id as string}
          row={row}
          entity={entity}
          basePath={basePath}
          titleField={titleField}
          statusField={statusField}
          subtitleColumns={subtitleColumns}
          extraColumns={extraColumns}
        />
      ))}
    </div>
  );
}

/**
 * Single mobile card. Splits into:
 * - Link region (tap anywhere on the title/subtitle navigates to the detail page).
 * - Optional "More" toggle that expands inline to show the remaining columns
 *   (audit F-085). The toggle is rendered as a button to stop propagation,
 *   so tapping it doesn't navigate.
 */
function EntityMobileCard({
  row,
  entity,
  basePath,
  titleField,
  statusField,
  subtitleColumns,
  extraColumns,
}: {
  row: Record<string, unknown>;
  entity: EntityConfig<Record<string, unknown>>;
  basePath: string;
  titleField: string;
  statusField: string | undefined;
  subtitleColumns: EntityColumnDef<Record<string, unknown>>[];
  extraColumns: EntityColumnDef<Record<string, unknown>>[];
}) {
  const id = row.id as string;
  const title = row[titleField] ?? "Untitled";
  const statusValue = statusField ? (row[statusField] as string | undefined) : undefined;
  const [expanded, setExpanded] = useState(false);
  const hasExtras = extraColumns.length > 0;

  return (
    <div className="rounded-lg border bg-card transition-colors active:bg-accent/50">
      <Link href={`${basePath}/${id}`} className="block p-3">
        {/* Header row: title + status badge */}
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-sm truncate">{String(title)}</span>
          {statusValue && (
            <StatusBadge
              status={statusValue}
              config={entity.stateMachine?.stateDisplay}
            />
          )}
        </div>

        {/* Always-visible subtitle rows */}
        {subtitleColumns.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            {subtitleColumns.map((col) => {
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

        {/* Expanded extras */}
        {expanded && hasExtras && (
          <div className="mt-2 pt-2 border-t flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            {extraColumns.map((col) => {
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

      {/* "More" toggle — outside the Link so taps don't trigger navigation. */}
      {hasExtras && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          aria-expanded={expanded}
          aria-controls={`card-extras-${id}`}
          className="w-full px-3 py-2 border-t text-xs text-muted-foreground hover:bg-muted/50 flex items-center justify-center gap-1"
        >
          {expanded ? "Show less" : `Show ${extraColumns.length} more field${extraColumns.length === 1 ? "" : "s"}`}
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
