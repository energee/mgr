"use client";

/**
 * BulkStatusActionBar
 *
 * Renders a floating action bar for bulk operations on selected rows:
 * - Status transitions (entities with a stateMachine): computes valid
 *   transitions across all selected rows (intersection). Selection is
 *   id-keyed and survives pagination, so `selectedRows` may include
 *   last-seen snapshots of rows from other pages (entity-data-table
 *   syncSelectionSnapshots); the apply path re-validates current states
 *   server-side by id, so a stale snapshot can only hide an option, never
 *   apply an invalid transition.
 * - Bulk delete (entities with a delete action): opens the multi-record
 *   EntityBulkDeleteDialog via `onBulkDelete`.
 *
 * Apply reports what the database actually moved: `onStatusChange` resolves to
 * the number of transitioned records, and a resolved `0` suppresses the success
 * toast entirely (the caller has already surfaced the failure). `undefined`
 * means the callback opted out of counting and falls back to the selection size.
 *
 * Targets listed in stateMachine.requiresAction render as disabled options
 * with a hint pointing at the named entity action — those transitions need
 * the action's interactive flow (e.g. the batch archive dialog capturing
 * loss volume), so a bulk bare status UPDATE is never offered for them.
 */

import { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import type { EntityConfig } from "@/types/entity";
import { getStateLabel } from "@/types/entity";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, X } from "lucide-react";

type BulkStatusActionBarProps<T> = {
  entity: EntityConfig<T>;
  selectedRows: T[];
  /**
   * Applies `targetStatus` to the selection and resolves with the number of
   * records that actually transitioned. `0` means none did — the bar shows no
   * success toast and relies on the caller's own error toast. `undefined` means
   * the callback did not count, and the bar falls back to the selection size.
   */
  onStatusChange: (targetStatus: string) => Promise<number | undefined>;
  onClearSelection: () => void;
  /**
   * Open the bulk delete dialog. Omitted when the entity has no delete
   * action or when no selected row is deletable (per-row showWhen /
   * fromStates / disabledWhen — evaluated by entity-data-table).
   */
  onBulkDelete?: () => void;
  /**
   * How many selected rows the delete action applies to. Shown on the
   * button when it differs from the selection size, so mixed selections
   * make clear that only the eligible subset will be deleted.
   */
  bulkDeleteCount?: number;
}

/**
 * Target states reachable from EVERY selected row — the intersection of each
 * distinct current state's allowed transitions.
 *
 * Shared with entity-data-table, which gates the whole action bar on whether
 * this is non-empty; keeping one implementation stops the bar from being shown
 * for a selection that then renders "no common status transitions", or hidden
 * for one that has them.
 *
 * Rows whose state field is absent contribute the state `undefined`, which no
 * `transitions` map has a key for, so the intersection collapses to empty —
 * the selection offers no bulk transition rather than an unvalidated one.
 * Returns `[]` for an entity with no state machine or an empty selection.
 */
export function commonBulkTransitions<T>(
  entity: EntityConfig<T>,
  selectedRows: T[]
): string[] {
  if (!entity.stateMachine || selectedRows.length === 0) return [];

  const stateField = entity.stateMachine.stateField;
  const transitions = entity.stateMachine.transitions;

  const currentStates = new Set(
    selectedRows.map(
      (row) => (row as Record<string, unknown>)[stateField] as string
    )
  );

  let commonTargets: string[] | null = null;
  for (const state of currentStates) {
    const allowed = transitions[state] || [];
    commonTargets =
      commonTargets === null
        ? [...allowed]
        : commonTargets.filter((t) => allowed.includes(t));
  }

  return commonTargets ?? [];
}

export function BulkStatusActionBar<T>({
  entity,
  selectedRows,
  onStatusChange,
  onClearSelection,
  onBulkDelete,
  bulkDeleteCount,
}: BulkStatusActionBarProps<T>) {
  const [bulkTargetStatus, setBulkTargetStatus] = useState("");
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);

  // Compute valid bulk transitions for selected rows
  const bulkTransitionOptions = useMemo(() => {
    const requiresAction = entity.stateMachine?.requiresAction;
    return commonBulkTransitions(entity, selectedRows).map((state) => {
      // Targets owned by a named action can't be bulk-applied — surface the
      // option disabled with a pointer to the per-record action instead.
      const requiredActionName = requiresAction?.[state];
      const requiredAction = requiredActionName
        ? entity.actions?.find((a) => a.name === requiredActionName)
        : undefined;
      return {
        value: state,
        label: getStateLabel(entity, state),
        disabledHint: requiredActionName
          ? `use ${requiredAction?.label ?? requiredActionName} per item`
          : undefined,
      };
    });
  }, [entity, selectedRows]);

  const handleApply = useCallback(async () => {
    if (!bulkTargetStatus) return;

    setIsBulkUpdating(true);
    try {
      // `0` is an in-band result ("nothing transitioned"), so coalesce with ??
      // — `||` would fall back to the selection size and claim a success that
      // did not happen. Every zero-count path in the caller already raised its
      // own toast.error, so staying silent here leaves one accurate message.
      const count = await onStatusChange(bulkTargetStatus);
      const updated = count ?? selectedRows.length;
      if (updated > 0) {
        toast.success(
          `Updated ${updated} ${
            updated === 1
              ? entity.displayName.toLowerCase()
              : entity.displayNamePlural.toLowerCase()
          } to ${
            getStateLabel(entity, bulkTargetStatus)
          }`
        );
      }
      setBulkTargetStatus("");
    } catch {
      toast.error("Failed to update status. Please try again.");
    } finally {
      setIsBulkUpdating(false);
    }
  }, [
    bulkTargetStatus,
    onStatusChange,
    selectedRows.length,
    entity,
  ]);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-3 bg-background border rounded-lg shadow-lg px-4 py-3">
        <span className="text-sm font-medium whitespace-nowrap">
          {selectedRows.length} selected
        </span>
        {/* Status section — only for stateMachine entities; delete-only
            entities get just the Delete button */}
        {entity.stateMachine && <div className="h-4 w-px bg-border" />}
        {!entity.stateMachine ? null : bulkTransitionOptions.length > 0 ? (
          <>
            <Select
              value={bulkTargetStatus || "_placeholder"}
              onValueChange={(v) =>
                setBulkTargetStatus(
                  v === "_placeholder" ? "" : v
                )
              }
            >
              <SelectTrigger className="h-8 w-[180px] text-sm">
                <SelectValue placeholder="Change status to..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_placeholder" disabled>
                  Change status to...
                </SelectItem>
                {bulkTransitionOptions.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    disabled={!!opt.disabledHint}
                  >
                    {opt.label}
                    {opt.disabledHint && (
                      <span className="text-muted-foreground text-xs">
                        {" "}— {opt.disabledHint}
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={handleApply}
              disabled={!bulkTargetStatus || isBulkUpdating}
            >
              {isBulkUpdating ? "Updating..." : "Apply"}
            </Button>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">
            No common status transitions available
          </span>
        )}
        {onBulkDelete && (
          <>
            <div className="h-4 w-px bg-border" />
            <Button
              variant="destructive"
              size="sm"
              onClick={onBulkDelete}
              disabled={isBulkUpdating}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              {bulkDeleteCount != null && bulkDeleteCount < selectedRows.length
                ? `Delete ${bulkDeleteCount} of ${selectedRows.length}`
                : "Delete"}
            </Button>
          </>
        )}
        <div className="h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onClearSelection();
            setBulkTargetStatus("");
          }}
        >
          <X className="h-4 w-4 mr-1" />
          Clear
        </Button>
      </div>
    </div>
  );
}
