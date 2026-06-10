"use client";

/**
 * Packaging Completion Review Modal
 *
 * Review dialog shown before completing a packaging session. Displays
 * per-line-item variance, flags missing actuals, and requires confirmation.
 *
 * Completion flow (audit Batch 9):
 * 1. Implied loss check (9.3): planned units x fill volume - actual units x
 *    fill volume per batch (fill volume = container volume_bbl x unit_count).
 *    Positive differences prompt a RecordLossDialog per batch BEFORE the
 *    status flips (the dialog unmounts once the session is completed).
 * 2. Transition the session to "completed" (DB trigger creates finished goods).
 * 3. Material depletion (9.2): consume selling_format_materials BOM lines x
 *    actual quantity from inventory lots (FIFO, completed allocations,
 *    destination = the line item's batch) via consumePackagingMaterials.
 */

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { entityKeys, sessionLineItemKeys, inventoryKeys, materialPlanningKeys } from "@/lib/query-keys";
import {
  consumePackagingMaterials,
  type PackagingDepletionLineItem,
} from "@/services/consumption-service";
import { computePackagingLoss } from "@/domain/consumption-planning";
import { RecordLossDialog } from "@/components/domain/shared/record-loss-dialog";
import { formatServiceError } from "@/services/types";
import { log } from "@/lib/client-logger";

type ReviewLineItem = {
  id: string;
  brand_name: string;
  batch_code: string | null;
  format_name: string | null;
  planned_quantity: number | null;
  actual_quantity: number | null;
};

type PackagingCompletionReviewProps = {
  sessionId: string;
  items: ReviewLineItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
};

/** One queued implied-loss prompt (per source batch). */
type LossPrompt = {
  batchId: string;
  batchCode: string;
  volumeBbl: number;
};

export function PackagingCompletionReview({
  sessionId,
  items,
  open,
  onOpenChange,
  onCompleted,
}: PackagingCompletionReviewProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");
  // Implied-loss prompts queued before completion. null = not computed yet.
  const [lossQueue, setLossQueue] = useState<LossPrompt[] | null>(null);
  // Line items fetched by the loss check, reused by consumePackagingMaterials
  // so the service doesn't re-fetch the same rows. null when the loss check
  // failed (the service then falls back to fetching them itself).
  const lineItemsRef = useRef<PackagingDepletionLineItem[] | null>(null);

  const missingActualCount = items.filter(
    (item) => item.actual_quantity == null
  ).length;

  const totalPlanned = items.reduce(
    (sum, item) => sum + (item.planned_quantity ?? 0),
    0
  );
  const totalActual = items.reduce(
    (sum, item) => sum + (item.actual_quantity ?? 0),
    0
  );

  // Step 2+3: flip status (trigger creates FGs), then deplete materials.
  const completeMutation = useMutation({
    mutationFn: async () => {
      const updates: Record<string, unknown> = { status: "completed" };
      if (notes.trim()) {
        updates.notes = notes.trim();
      }
      const { error } = await supabase
        .from("packaging_sessions")
        .update(updates)
        .eq("id", sessionId);
      if (error) throw error;

      // Material depletion (9.2). The session is already completed at this
      // point — depletion failures are surfaced but do not roll it back.
      // Reuses the loss check's line-item rows when available.
      const depletion = await consumePackagingMaterials(
        supabase,
        sessionId,
        lineItemsRef.current ?? undefined,
      );
      return depletion;
    },
    onSuccess: (depletion) => {
      queryClient.invalidateQueries({
        queryKey: entityKeys.detail("packaging_sessions", sessionId),
      });
      queryClient.invalidateQueries({
        queryKey: sessionLineItemKeys.all(sessionId),
      });
      queryClient.invalidateQueries({
        queryKey: entityKeys.list("packaging_sessions_with_summary"),
      });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.allocations() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.lots() });
      queryClient.invalidateQueries({
        queryKey: materialPlanningKeys.sessionMaterials(sessionId),
      });
      toast.success("Packaging session completed");
      if (!depletion.success) {
        log.error("Packaging material depletion failed:", depletion.error);
        toast.warning(
          `Material depletion failed: ${formatServiceError(depletion.error)}`
        );
      } else if (depletion.data.shortfalls.length > 0) {
        toast.warning(
          `${depletion.data.shortfalls.length} material${depletion.data.shortfalls.length === 1 ? "" : "s"} had insufficient lot inventory — partial depletion recorded`
        );
      } else if (depletion.data.allocations_inserted > 0) {
        toast.success(
          `${depletion.data.allocations_inserted} material allocation${depletion.data.allocations_inserted === 1 ? "" : "s"} recorded`
        );
      }
      onCompleted();
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(
        `Failed to complete session: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    },
  });

  // Step 1: compute implied packaging loss per batch, prompting before
  // completion (this dialog unmounts once the session status flips).
  const lossCheckMutation = useMutation({
    mutationFn: async (): Promise<LossPrompt[]> => {
      lineItemsRef.current = null;
      // Selects the union of what the loss math needs and what
      // consumePackagingMaterials needs (selling_format_id), so the rows
      // can be passed through and the service skips its own fetch.
      const { data, error } = await supabase
        .from("session_line_items")
        .select(
          `batch_id, selling_format_id, planned_quantity, actual_quantity,
           batch:batches(batch_code),
           selling_format:selling_formats(unit_count, container:containers(volume_bbl))`
        )
        .eq("session_id", sessionId);
      if (error) throw error;

      // Supabase infers the batches join as an array; it is many-to-one
      type LossRow = {
        batch_id: string | null;
        selling_format_id: string | null;
        planned_quantity: number | null;
        actual_quantity: number | null;
        batch: { batch_code: string } | null;
        selling_format: {
          unit_count: number | null;
          container: { volume_bbl: number | null } | null;
        } | null;
      };
      const rows = (data ?? []) as unknown as LossRow[];
      lineItemsRef.current = rows.map((row) => ({
        selling_format_id: row.selling_format_id,
        actual_quantity: row.actual_quantity,
        batch_id: row.batch_id,
      }));

      const codeByBatch = new Map<string, string>();
      const lossLines = rows.map((row) => {
        const unitVolume =
          row.selling_format?.container?.volume_bbl != null
            ? row.selling_format.container.volume_bbl *
              (row.selling_format.unit_count ?? 1)
            : null;
        if (row.batch_id && row.batch?.batch_code) {
          codeByBatch.set(row.batch_id, row.batch.batch_code);
        }
        return {
          batch_id: row.batch_id,
          planned_quantity: row.planned_quantity,
          actual_quantity: row.actual_quantity,
          unit_volume_bbl: unitVolume,
        };
      });

      const lossByBatch = computePackagingLoss(lossLines);
      return [...lossByBatch.entries()].map(([batchId, volumeBbl]) => ({
        batchId,
        batchCode: codeByBatch.get(batchId) ?? batchId.slice(0, 8),
        volumeBbl,
      }));
    },
    onSuccess: (prompts) => {
      if (prompts.length === 0) {
        completeMutation.mutate();
      } else {
        setLossQueue(prompts);
      }
    },
    onError: (error) => {
      // Loss capture is best-effort — never block completion on it
      log.error("Packaging loss check failed:", error);
      completeMutation.mutate();
    },
  });

  /** Advance the loss queue; completes the session when drained. */
  const advanceLossQueue = () => {
    const next = (lossQueue ?? []).slice(1);
    if (next.length === 0) {
      setLossQueue(null);
      completeMutation.mutate();
    } else {
      setLossQueue(next);
    }
  };

  const handleConfirm = () => {
    if (completeMutation.isPending || lossCheckMutation.isPending) return;
    lossCheckMutation.mutate();
  };

  const isPending = completeMutation.isPending || lossCheckMutation.isPending;
  const currentLoss = lossQueue?.[0] ?? null;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Complete Packaging Session</DialogTitle>
          <DialogDescription>
            Review the packaging results before finalizing this session.
          </DialogDescription>
        </DialogHeader>

        {missingActualCount > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {missingActualCount} item{missingActualCount !== 1 ? "s" : ""} ha
              {missingActualCount !== 1 ? "ve" : "s"} no actual quantity. These
              items will not generate finished goods.
            </span>
          </div>
        )}

        <div className="max-h-[400px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Brand</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>Format</TableHead>
                <TableHead className="text-right">Planned</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const hasActual =
                  item.actual_quantity !== null &&
                  item.actual_quantity !== undefined;
                const variance = hasActual
                  ? (item.actual_quantity ?? 0) - (item.planned_quantity ?? 0)
                  : null;
                const varianceColor =
                  variance === null
                    ? "text-muted-foreground"
                    : variance >= 0
                      ? "text-green-600"
                      : "text-red-600";

                return (
                  <TableRow
                    key={item.id}
                    className={!hasActual ? "bg-red-50" : undefined}
                  >
                    <TableCell className="font-medium">
                      {item.brand_name}
                    </TableCell>
                    <TableCell>{item.batch_code ?? "—"}</TableCell>
                    <TableCell>{item.format_name ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {item.planned_quantity ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {hasActual ? item.actual_quantity : "—"}
                    </TableCell>
                    <TableCell className={`text-right ${varianceColor}`}>
                      {variance === null
                        ? "—"
                        : variance > 0
                          ? `+${variance}`
                          : variance}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="text-right font-medium">
                  Totals
                </TableCell>
                <TableCell className="text-right font-bold">
                  {totalPlanned}
                </TableCell>
                <TableCell className="text-right font-bold">
                  {totalActual}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </div>

        <div className="space-y-2">
          <label htmlFor="completion-notes" className="text-sm font-medium">
            Completion Notes (optional)
          </label>
          <Textarea
            id="completion-notes"
            placeholder="Any notes about this packaging session..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Go Back
          </Button>
          <Button onClick={handleConfirm} disabled={isPending || !!currentLoss}>
            {isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Confirm Completion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Implied packaging loss prompt (9.3), one per source batch */}
    {currentLoss && (
      <RecordLossDialog
        batchId={currentLoss.batchId}
        batchNumber={currentLoss.batchCode}
        suggestedVolumeBbl={currentLoss.volumeBbl}
        context="Packaging variance (planned vs actual fill volume)"
        open={!!currentLoss}
        onOpenChange={(o) => {
          if (!o) advanceLossQueue();
        }}
      />
    )}
    </>
  );
}
