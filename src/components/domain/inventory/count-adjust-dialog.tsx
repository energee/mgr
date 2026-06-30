"use client";

/**
 * CountAdjustDialog - Guided cycle-count / adjustment workflow (audit
 * finding 27). Before this, the only path to a count_adjustment was the
 * generic allocation form with raw-UUID text inputs.
 *
 * The counter picks an inventory lot from a dropdown (expected on-hand
 * shown inline, zero-remaining lots included so found stock can be
 * recorded), enters the physically counted quantity, and the dialog shows
 * the delta that will be applied:
 * - counted < expected → completed 'adjustment' allocation (shrinkage,
 *   reason_code='count_adjustment')
 * - counted > expected → inventory_lots.quantity raised directly with an
 *   audit note (allocations cannot add stock: CHECK quantity >= 0)
 * - counted = expected → nothing written
 *
 * Writes go through recordInventoryCount (inventory-count-service.ts);
 * the reconciliation math is src/domain/inventory-count.ts.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { inventoryKeys } from "@/lib/query-keys";
import { recordInventoryCount } from "@/services/inventory-count-service";
import { formatServiceError } from "@/services/types";
import { planCountAdjustment } from "@/domain/inventory-count";
import { formatSmartDecimal } from "@/lib/format";
import { log } from "@/lib/client-logger";

type LotOption = {
  id: string;
  label: string;
  expected: number;
  unit: string | null;
};

type CountAdjustDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

/** Parse a non-negative quantity ("0" is a valid count — lot is empty). */
function parseCountedQuantity(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function CountAdjustDialog({
  open,
  onOpenChange,
  onSuccess,
}: CountAdjustDialogProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const [lotId, setLotId] = useState("");
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");

  // Reset fields when the dialog opens (adjust-state-during-render pattern,
  // mirrors QuickDepletionDialog).
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setLotId("");
      setCounted("");
      setNotes("");
    }
  }

  // All lots — zero-remaining included, so a count can record found stock
  // on a lot the system believes is depleted.
  const { data: lots, isLoading: lotsLoading } = useQuery({
    queryKey: inventoryKeys.countLots(),
    queryFn: async (): Promise<LotOption[]> => {
      const { data, error } = await supabase
        .from("inventory_lots_with_quantities")
        .select("id, item_name, lot_number, remaining_quantity, unit")
        .order("item_name")
        // Defensive cap — keeps the picker dropdown bounded
        .limit(300);
      if (error) throw error;
      return (data ?? [])
        .filter((lot) => lot.id)
        .map((lot) => ({
          id: lot.id as string,
          label: [lot.item_name, lot.lot_number].filter(Boolean).join(" · "),
          expected: lot.remaining_quantity ?? 0,
          unit: lot.unit,
        }));
    },
    enabled: open,
  });

  const selectedLot = lots?.find((l) => l.id === lotId);
  const countedQuantity = parseCountedQuantity(counted);
  const plan =
    selectedLot && countedQuantity !== null
      ? planCountAdjustment(selectedLot.expected, countedQuantity)
      : null;
  const unitSuffix = selectedLot?.unit ? ` ${selectedLot.unit}` : "";

  const countMutation = useMutation({
    mutationFn: async () => {
      if (!selectedLot || countedQuantity === null)
        throw new Error("Pick a lot and enter the counted quantity");
      const result = await recordInventoryCount(supabase, {
        lotId: selectedLot.id,
        expectedQuantity: selectedLot.expected,
        countedQuantity,
        notes: notes.trim() || null,
      });
      if (!result.success) throw new Error(formatServiceError(result.error));
      return result.data;
    },
    onSuccess: (appliedPlan) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.lots() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.itemOnHand() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.allocations() });
      if (appliedPlan.kind === "none") {
        toast.success("Count matches expected on-hand — no adjustment needed");
      } else if (appliedPlan.kind === "decrease") {
        toast.success(
          `Shrinkage of ${formatSmartDecimal(appliedPlan.delta, 3)}${unitSuffix} recorded`
        );
      } else {
        toast.success(
          `Lot quantity increased by ${formatSmartDecimal(appliedPlan.delta, 3)}${unitSuffix}`
        );
      }
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (e) => {
      log.error("Count adjustment error:", e);
      toast.error(e instanceof Error ? e.message : "Failed to record count");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Count / Adjust</DialogTitle>
          <DialogDescription>
            Enter what you physically counted — the difference is recorded
            automatically. No UUIDs required.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Lot</Label>
            <Select value={lotId} onValueChange={setLotId} disabled={lotsLoading}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue placeholder={lotsLoading ? "Loading..." : "Select a lot..."} />
              </SelectTrigger>
              <SelectContent>
                {lots?.length === 0 ? (
                  <div className="p-2 text-sm text-muted-foreground text-center">
                    No lots found
                  </div>
                ) : (
                  lots?.map((lot) => (
                    <SelectItem key={lot.id} value={lot.id}>
                      {lot.label}
                      <span className="text-muted-foreground ml-2">
                        ({formatSmartDecimal(lot.expected, 3)}
                        {lot.unit ? ` ${lot.unit}` : ""} expected)
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="counted-quantity">Counted quantity</Label>
            <Input
              id="counted-quantity"
              type="number"
              min={0}
              step="any"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              placeholder={
                selectedLot
                  ? `Expected: ${formatSmartDecimal(selectedLot.expected, 3)}`
                  : "e.g., 100"
              }
              className="min-h-[44px]"
            />
            {plan && plan.kind === "decrease" && (
              <p className="text-sm text-yellow-700">
                Will record shrinkage of {formatSmartDecimal(plan.delta, 3)}
                {unitSuffix} (completed adjustment allocation).
              </p>
            )}
            {plan && plan.kind === "increase" && (
              <p className="text-sm text-yellow-700">
                Will increase lot quantity by {formatSmartDecimal(plan.delta, 3)}
                {unitSuffix} (with an audit note on the lot).
              </p>
            )}
            {plan && plan.kind === "none" && (
              <p className="text-sm text-muted-foreground">
                Matches expected on-hand — nothing will be written.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="count-notes">Notes (optional)</Label>
            <Textarea
              id="count-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g., damaged bag found behind rack 3"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => countMutation.mutate()}
            disabled={countMutation.isPending || !selectedLot || countedQuantity === null}
          >
            {countMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Recording...
              </>
            ) : (
              "Record Count"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
