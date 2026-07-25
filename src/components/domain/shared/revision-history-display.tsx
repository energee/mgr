/**
 * RevisionHistoryDisplay - Wrapper component for entity detail sections
 *
 * Adapts RevisionHistory component to work with EntityDetail's custom
 * component section pattern. Extracts entity info from data prop.
 *
 * No "use client" here: this file only composes JSX around the client
 * `RevisionHistory` component (which carries its own directive) and uses no
 * hooks itself. `createRevisionHistoryDisplay()` is invoked eagerly at module
 * scope inside each entity's `presentation.tsx`, so if this file were a
 * client boundary, any server-only import of that presentation module would
 * try to call a client-reference function and crash
 * (SENTRY-7611936148 / MGR-S).
 */

import { RevisionHistory } from "./revision-history";

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
