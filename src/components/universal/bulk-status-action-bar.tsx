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
    if (!entity.stateMachine || selectedRows.length === 0) return [];

    const stateField = entity.stateMachine.stateField;
    const transitions = entity.stateMachine.transitions;

    // Get the set of current states for all selected rows
    const currentStates = new Set(
      selectedRows.map(
        (row) =>
          (row as Record<string, unknown>)[stateField] as string
      )
    );

    // Find transitions valid for ALL selected items
    let commonTargets: string[] | null = null;
    for (const state of currentStates) {
      const allowed = transitions[state] || [];
      if (commonTargets === null) {
        commonTargets = [...allowed];
      } else {
        commonTargets = commonTargets.filter((t) =>
          allowed.includes(t)
        );
      }
    }

    const requiresAction = entity.stateMachine.requiresAction;
    return (commonTargets || []).map((state) => {
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
      const count = await onStatusChange(bulkTargetStatus);
      toast.success(
        `Updated ${count || selectedRows.length} ${
          (count || selectedRows.length) === 1
            ? entity.displayName.toLowerCase()
            : entity.displayNamePlural.toLowerCase()
        } to ${
          getStateLabel(entity, bulkTargetStatus)
        }`
      );
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
