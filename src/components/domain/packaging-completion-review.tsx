"use client";

/**
 * Packaging Completion Review Modal
 *
 * Review dialog shown before completing a packaging session. Displays
 * per-line-item variance, flags missing actuals, and requires confirmation.
 * On confirm, transitions the session to "completed" status.
 */

import { useState } from "react";
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
import { entityKeys, sessionLineItemKeys } from "@/lib/query-keys";

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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: entityKeys.detail("packaging_sessions", sessionId),
      });
      queryClient.invalidateQueries({
        queryKey: sessionLineItemKeys.all(sessionId),
      });
      queryClient.invalidateQueries({
        queryKey: entityKeys.list("packaging_sessions_with_summary"),
      });
      toast.success("Packaging session completed");
      onCompleted();
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(
        `Failed to complete session: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    },
  });

  return (
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
          <Button
            onClick={() => completeMutation.mutate()}
            disabled={completeMutation.isPending}
          >
            {completeMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Confirm Completion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
