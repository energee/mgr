"use client";

/**
 * RevisionHistoryDisplay - Wrapper component for entity detail sections
 *
 * Adapts RevisionHistory component to work with EntityDetail's custom
 * component section pattern. Extracts entity info from data prop.
 */

import { RevisionHistory } from "./revision-history";

type RevisionHistoryDisplayProps = {
  data: { id: string | null };
  /** Table name to query revisions for */
  entityType: string;
}

/**
 * Factory function to create a revision history display component
 * for a specific entity type.
 *
 * Uses a generic type to accept any entity data that has an id field.
 */
export function createRevisionHistoryDisplay(entityType: string) {
  return function RevisionHistoryDisplayComponent({
    data,
  }: {
    data: { id: string | null } & Record<string, unknown>;
  }) {
    if (!data.id) {
      return (
        <p className="text-sm text-muted-foreground">
          No revision history available (missing ID)
        </p>
      );
    }

    return (
      <RevisionHistory
        entityType={entityType}
        entityId={data.id}
        maxInitial={5}
      />
    );
  };
}

/**
 * Generic revision history display that requires entityType in props.
 * Use createRevisionHistoryDisplay() for entity config sections.
 */
export function RevisionHistoryDisplay({
  data,
  entityType,
}: RevisionHistoryDisplayProps) {
  if (!data.id) {
    return (
      <p className="text-sm text-muted-foreground">
        No revision history available (missing ID)
      </p>
    );
  }

  return (
    <RevisionHistory
      entityType={entityType}
      entityId={data.id}
      maxInitial={5}
    />
  );
}
