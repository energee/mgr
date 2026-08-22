"use client";

/**
 * EntityEmptyState
 *
 * The "nothing to show" panel shared by both list surfaces of an entity: the
 * desktop table's `noResultsContent` (entity-data-table) and the mobile card
 * list's zero-row branch (entity-mobile-card-list). The two rendered it as
 * byte-identical JSX before this component existed, so a copy edit to one
 * silently drifted from the other.
 *
 * Two shapes, chosen by `hasActiveFilters`:
 * - filtered → "No matching {plural}" + a nudge to relax the search/filters.
 *   No create button: the entity may well have rows, just none matching, so
 *   offering "Create" here would misread as "this entity is empty".
 * - unfiltered → "No {plural} yet" + the create affordance (when `showCreate`),
 *   either an `onCreateClick` handler (dialog-based creation) or a link to
 *   `{basePath}/new`.
 *
 * `entity` is structurally typed rather than `EntityConfig<T>` so both call
 * sites can pass their config directly without a generic cast.
 */

import Link from "next/link";
import { Search, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";

type EntityEmptyStateProps = {
  entity: { displayName: string; displayNamePlural: string };
  /** Whether a search term or column filter is narrowing the list. */
  hasActiveFilters: boolean;
  /** Whether the create affordance may be offered at all. */
  showCreate?: boolean;
  /** Route prefix for the fallback `{basePath}/new` create link. */
  basePath: string;
  /** Dialog-based creation; when omitted the create button is a link. */
  onCreateClick?: () => void;
};

export function EntityEmptyState({
  entity,
  hasActiveFilters,
  showCreate,
  basePath,
  onCreateClick,
}: EntityEmptyStateProps) {
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
            <p className="text-sm">Try adjusting your search or filters</p>
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
              <Link href={`${basePath}/new`}>Create {entity.displayName}</Link>
            </Button>
          )}
        </>
      )}
    </div>
  );
}
