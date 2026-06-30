/**
 * Entity action helpers.
 *
 * Shared visibility filtering for entity-config actions, used by every
 * list-view action surface (desktop actions column in
 * components/data-table/adapter.tsx and the mobile card menu in
 * components/universal/entity-mobile-card-list.tsx) so the two stay in sync.
 *
 * Note: entity-detail-unified.tsx intentionally does NOT use this helper —
 * its detail view keeps fromStates-gated actions visible when the record has
 * no state info, which diverges from the list semantics here.
 */

import type { EntityConfig, EntityActionDef } from "@/types/entity";

/**
 * Filter an entity's actions down to those applicable to `record`:
 * - `showWhen` predicate must pass (when defined)
 * - `fromStates` must include the record's current state (when defined);
 *   actions gated on `fromStates` are hidden when the state can't be read.
 *
 * Does not evaluate `disabledWhen` — callers render disabled menu items with
 * a reason rather than hiding them.
 */
export function getApplicableActions<T>(
  entity: EntityConfig<T>,
  record: T
): EntityActionDef<T>[] {
  return (entity.actions ?? []).filter((action) => {
    if (action.showWhen && !action.showWhen(record)) return false;
    if (action.fromStates) {
      const stateField = entity.stateMachine?.stateField as string | undefined;
      const currentState = stateField
        ? ((record as Record<string, unknown>)[stateField] as string)
        : null;
      if (!currentState || !action.fromStates.includes(currentState)) {
        return false;
      }
    }
    return true;
  });
}
