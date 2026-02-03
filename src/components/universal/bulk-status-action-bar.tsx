"use client";

/**
 * BulkStatusActionBar
 *
 * Renders a floating action bar for bulk status transitions.
 * Computes valid transitions across all selected rows (intersection).
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
import { X } from "lucide-react";

interface BulkStatusActionBarProps<T> {
  entity: EntityConfig<T>;
  selectedRows: T[];
  onStatusChange: (targetStatus: string) => Promise<number | undefined>;
  onClearSelection: () => void;
}

export function BulkStatusActionBar<T>({
  entity,
  selectedRows,
  onStatusChange,
  onClearSelection,
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

    return (commonTargets || []).map((state) => ({
      value: state,
      label: getStateLabel(entity, state),
    }));
  }, [entity.stateMachine, selectedRows]);

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
        <div className="h-4 w-px bg-border" />
        {bulkTransitionOptions.length > 0 ? (
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
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
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
