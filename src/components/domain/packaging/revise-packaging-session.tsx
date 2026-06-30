"use client";

/**
 * Revise Packaging Session Dialog (audit finding C2)
 *
 * The only path into the "revised" status. A completed session's actual
 * quantities are otherwise frozen (line items are read-only post-completion,
 * and the finished-goods trigger only fires on entry into "completed"), so a
 * fat-fingered actual (300 cases instead of 30) had no correction route.
 *
 * Mirrors the PackagingCompletionReview table (brand / batch / format /
 * planned / recorded), adds an editable "New actual" column, and submits the
 * changed lines to the revise_packaging_session RPC (migration 00184), which
 * transactionally:
 *   - updates session_line_items.actual_quantity
 *   - adjusts/creates the linked finished_goods rows (+ batch allocations),
 *     refusing reductions below already-committed outbound allocations
 *   - applies the BOM material-depletion delta (consume more / reverse)
 *   - records keg fill deltas for keg-container lines
 *   - flips the session status to revised
 *
 * Wiring: stateMachine.requiresAction routes completed -> revised through the
 * "revise" entity action, which the detail page intercepts to open this
 * dialog; a DB trigger guard blocks bare status flips as the backstop.
 * Loss allocations recorded at completion are intentionally NOT recomputed.
 */

import { useMemo, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  entityKeys,
  finishedGoodKeys,
  inventoryKeys,
  materialPlanningKeys,
  sessionLineItemKeys,
} from "@/lib/query-keys";
import { useSessionLineItems } from "@/hooks/use-session-line-items";
import {
  evaluateReviseDrafts,
  type ReviseItemPayload,
} from "@/domain/packaging-revision";
import { parseUnknownError } from "@/lib/errors";
import type { Json } from "@/types/supabase";

type RevisePackagingSessionProps = {
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Shape of the revise_packaging_session RPC's jsonb result. */
type ReviseResult = {
  lines_updated: number;
  fg_created: number;
  fg_updated: number;
  allocations_inserted: number;
  allocations_reversed: number;
  shortfalls: Array<{ inventory_item_id: string; quantity: number }>;
};

export function RevisePackagingSession({
  sessionId,
  open,
  onOpenChange,
}: RevisePackagingSessionProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { items, isLoading } = useSessionLineItems(sessionId);

  // Raw draft strings, keyed by line item id, holding ONLY the rows the user
  // has touched (untouched rows fall back to the recorded actual at render
  // time). Raw strings mean typing is never reformatted mid-keystroke (see
  // useNumericInput's rationale), and the overrides-only shape matches
  // evaluateReviseDrafts' "missing draft = unchanged" contract. Cleared when
  // the dialog closes (handleOpenChange) so each open starts fresh.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setDrafts({});
      setReason("");
    }
    onOpenChange(next);
  };

  const { changed, deltaByLine, errorByLine } = useMemo(
    () => evaluateReviseDrafts(items ?? [], drafts),
    [items, drafts]
  );

  const reviseMutation = useMutation({
    mutationFn: async (payload: ReviseItemPayload[]) => {
      const { data, error } = await supabase.rpc("revise_packaging_session", {
        p_session_id: sessionId,
        p_items: payload as unknown as Json,
        p_reason: reason.trim() || undefined,
      });
      if (error) throw error;
      return data as unknown as ReviseResult;
    },
    onSuccess: (result) => {
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
      // Finished-good quantities changed — refresh both the domain caches
      // and the universal list over the availability view.
      queryClient.invalidateQueries({ queryKey: finishedGoodKeys.all() });
      queryClient.invalidateQueries({
        queryKey: entityKeys.all("finished_goods_with_availability"),
      });

      const fgParts: string[] = [];
      if (result.fg_updated > 0) fgParts.push(`${result.fg_updated} finished good lot${result.fg_updated === 1 ? "" : "s"} adjusted`);
      if (result.fg_created > 0) fgParts.push(`${result.fg_created} created`);
      toast.success(
        `Session revised — ${result.lines_updated} line${result.lines_updated === 1 ? "" : "s"} updated${fgParts.length > 0 ? `, ${fgParts.join(", ")}` : ""}`
      );
      if (result.shortfalls.length > 0) {
        toast.warning(
          `${result.shortfalls.length} material${result.shortfalls.length === 1 ? "" : "s"} had insufficient lot inventory — partial depletion recorded`
        );
      }
      handleOpenChange(false);
    },
    onError: (error) => {
      toast.error(`Failed to revise session: ${parseUnknownError(error).message}`);
    },
  });

  const hasErrors = errorByLine.size > 0;
  const isPending = reviseMutation.isPending;

  const handleConfirm = () => {
    if (isPending || hasErrors || changed.length === 0) return;
    reviseMutation.mutate(changed);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Revise Quantities</DialogTitle>
          <DialogDescription>
            Correct the recorded actual quantities. Finished goods and
            packaging-material depletion are adjusted to match; recorded loss
            entries are not changed.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="max-h-[400px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Brand</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Format</TableHead>
                  <TableHead className="text-right">Planned</TableHead>
                  <TableHead className="text-right">Recorded</TableHead>
                  <TableHead className="w-28 text-right">New actual</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(items ?? []).map((item) => {
                  const error = errorByLine.get(item.id);
                  const delta = deltaByLine.get(item.id);
                  const deltaColor =
                    delta === undefined || delta === 0
                      ? "text-muted-foreground"
                      : delta > 0
                        ? "text-green-600"
                        : "text-red-600";
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        {item.brand_name}
                      </TableCell>
                      <TableCell>{item.batch_code ?? "—"}</TableCell>
                      <TableCell>{item.selling_format_name ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        {item.planned_quantity ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.actual_quantity ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Input
                          inputMode="numeric"
                          aria-label={`New actual quantity for ${item.brand_name}`}
                          aria-invalid={!!error}
                          className={`h-8 text-right ${error ? "border-red-500" : ""}`}
                          value={
                            drafts[item.id] ??
                            (item.actual_quantity != null
                              ? String(item.actual_quantity)
                              : "")
                          }
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [item.id]: e.target.value,
                            }))
                          }
                          title={error}
                        />
                      </TableCell>
                      <TableCell className={`text-right ${deltaColor}`}>
                        {delta === undefined
                          ? "—"
                          : delta > 0
                            ? `+${delta}`
                            : delta}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {hasErrors && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Quantities must be non-negative whole numbers. Fix the
              highlighted entries to continue.
            </span>
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="revision-reason" className="text-sm font-medium">
            Revision reason (optional)
          </label>
          <Textarea
            id="revision-reason"
            placeholder="Why are these quantities being corrected?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isPending || hasErrors || changed.length === 0}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Revision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
