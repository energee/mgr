/**
 * EntityMobileCardList - Mobile card layout for entity list pages.
 *
 * Renders entity rows as tappable cards below the md breakpoint.
 * Shows the first 3 listColumns from entity config, with the
 * detailHeader.title field as the card heading and a StatusBadge
 * when the entity has a stateMachine.
 */

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import type { EntityConfig, EntityColumnDef } from "@/types/entity";
import { StatusBadge } from "@/components/universal/status-badge";
import { formatValue } from "@/lib/utils";
import { UnitDisplay } from "@/components/ui/unit-input";
import { Button } from "@/components/ui/button";
import { Search, Inbox } from "lucide-react";

interface EntityMobileCardListProps {
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

  // ---- Pick the first 3 columns for subtitle rows, excluding title and status ----
  const subtitleColumns = useMemo(
    () =>
      entity.listColumns
        .filter((col) => {
          const key = col.accessorKey as string | undefined;
          if (!key) return false;
          if (key === titleField) return false;
          if (key === statusField) return false;
          return true;
        })
        .slice(0, 3),
    [entity.listColumns, titleField, statusField],
  );

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
        const title = row[titleField] ?? "Untitled";
        const statusValue = statusField
          ? (row[statusField] as string | undefined)
          : undefined;

        return (
          <Link
            key={id}
            href={`${basePath}/${id}`}
            className="block rounded-lg border bg-card p-3 active:bg-accent/50 transition-colors"
          >
            {/* Header row: title + status badge */}
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-sm truncate">
                {String(title)}
              </span>
              {statusValue && (
                <StatusBadge
                  status={statusValue}
                  config={entity.stateMachine?.stateDisplay}
                />
              )}
            </div>

            {/* Subtitle rows */}
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
          </Link>
        );
      })}
    </div>
  );
}
