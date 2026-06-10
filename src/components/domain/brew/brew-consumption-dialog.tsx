"use client";

/**
 * BrewConsumptionDialog - Confirm brew-day ingredient consumption
 *
 * Shown after "Start Brew Day". Lists the recipe's grain bill, hop schedule,
 * and other ingredients scaled to the batch volume, with FIFO-suggested
 * inventory lot draws (soonest expiry first). The brewer can adjust pick
 * quantities (set to 0 to skip a lot) before confirming.
 *
 * On confirm, inserts `planned` allocations (inventory_lot → batch) via
 * createPlannedConsumption. They are completed when the batch completes
 * (see completeBatchConsumption wiring in the batch detail page).
 *
 * Ingredients with no matching inventory item (name + category match,
 * mirroring calculate_material_shortfalls) are shown but not allocated.
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Loader2, Wheat } from "lucide-react";
import { toast } from "sonner";
import { consumptionKeys, inventoryKeys } from "@/lib/query-keys";
import {
  buildBrewConsumptionPlan,
  createPlannedConsumption,
  type BrewConsumptionLine,
  type ConfirmedConsumptionPick,
} from "@/services/consumption-service";
import { formatServiceError } from "@/services/types";
import { log } from "@/lib/client-logger";

type BrewConsumptionDialogProps = {
  batchId: string;
  batchNumber: string;
  recipeId: string;
  batchVolumeBbl: number | null;
  open: boolean;
  /**
   * Optional open-state mirror. Close always routes through skip/confirm
   * (which call onDone), so flow-controlled callers — where `open` derives
   * from pending state cleared by onDone — can omit this.
   */
  onOpenChange?: (open: boolean) => void;
  /** Called after confirm or skip — the caller continues its flow (e.g. navigate). */
  onDone: () => void;
};

/** Editable pick state keyed by `${lineIndex}:${lotId}`. */
type PickEdits = Record<string, number>;

export function BrewConsumptionDialog({
  batchId,
  batchNumber,
  recipeId,
  batchVolumeBbl,
  open,
  onOpenChange,
  onDone,
}: BrewConsumptionDialogProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<PickEdits>({});

  const { data: plan, isLoading, error } = useQuery({
    queryKey: consumptionKeys.brewPlan(recipeId, batchVolumeBbl),
    queryFn: async (): Promise<BrewConsumptionLine[]> => {
      const result = await buildBrewConsumptionPlan(supabase, recipeId, batchVolumeBbl);
      if (!result.success) throw new Error(formatServiceError(result.error));
      return result.data;
    },
    enabled: open,
    staleTime: 0,
  });

  // Reset quantity edits when the dialog reopens or the plan refreshes
  // (adjust-state-during-render pattern, avoids setState-in-effect)
  const [prevPlan, setPrevPlan] = useState<BrewConsumptionLine[] | undefined>(undefined);
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen || plan !== prevPlan) {
    setPrevOpen(open);
    setPrevPlan(plan);
    if (open) setEdits({});
  }

  const pickQty = (lineIdx: number, lotId: string, suggested: number): number => {
    const key = `${lineIdx}:${lotId}`;
    return edits[key] !== undefined ? edits[key] : suggested;
  };

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!plan) return 0;
      const picks: ConfirmedConsumptionPick[] = [];
      plan.forEach((line, lineIdx) => {
        for (const pick of line.picks) {
          const qty = pickQty(lineIdx, pick.lot_id, pick.quantity);
          if (qty > 0) {
            picks.push({
              lot_id: pick.lot_id,
              quantity: qty,
              unit_cost: pick.unit_cost,
              lot_number: pick.lot_number,
              ingredient_name: line.ingredient_name,
            });
          }
        }
      });
      const result = await createPlannedConsumption(supabase, batchId, picks);
      if (!result.success) throw new Error(formatServiceError(result.error));
      return result.data;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.allocations() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.lots() });
      if (count > 0) {
        toast.success(`${count} ingredient allocation${count === 1 ? "" : "s"} planned for ${batchNumber}`);
      }
      onOpenChange?.(false);
      onDone();
    },
    onError: (e) => {
      log.error("Brew consumption error:", e);
      toast.error(e instanceof Error ? e.message : "Failed to plan consumption");
    },
  });

  const handleSkip = () => {
    onOpenChange?.(false);
    onDone();
  };

  const hasAnyPicks = (plan ?? []).some((line) => line.picks.length > 0);
  const unmatchedCount = (plan ?? []).filter((l) => !l.inventory_item).length;
  const shortfallCount = (plan ?? []).filter((l) => l.shortfall > 0).length;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange?.(o) : handleSkip())}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wheat className="h-5 w-5" />
            Confirm Ingredient Consumption
          </DialogTitle>
          <DialogDescription>
            Suggested inventory lot draws for {batchNumber} (FIFO — soonest
            expiry first). Adjust quantities or set to 0 to skip a lot.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive">
            Failed to load consumption plan: {error instanceof Error ? error.message : "Unknown error"}
          </p>
        )}

        {plan && plan.length === 0 && (
          <p className="text-sm text-muted-foreground">
            This recipe has no ingredient lines to consume.
          </p>
        )}

        {plan && plan.length > 0 && (
          <>
            {(unmatchedCount > 0 || shortfallCount > 0) && (
              <div className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  {unmatchedCount > 0 && (
                    <p>
                      {unmatchedCount} ingredient{unmatchedCount === 1 ? " has" : "s have"} no
                      matching inventory item and will not be allocated.
                    </p>
                  )}
                  {shortfallCount > 0 && (
                    <p>
                      {shortfallCount} ingredient{shortfallCount === 1 ? " is" : "s are"} short on
                      available inventory — partial allocations suggested.
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="max-h-[400px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ingredient</TableHead>
                    <TableHead className="text-right">Required</TableHead>
                    <TableHead>Lot</TableHead>
                    <TableHead className="text-right w-32">Quantity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plan.map((line, lineIdx) => {
                    const unit = line.inventory_item?.unit ?? line.recipe_unit;
                    if (!line.inventory_item) {
                      return (
                        <TableRow key={`${line.catalog_type}-${line.ingredient_name}`} className="bg-muted/30">
                          <TableCell className="font-medium">{line.ingredient_name}</TableCell>
                          <TableCell className="text-right">
                            {line.required_quantity.toFixed(2)} {line.recipe_unit}
                          </TableCell>
                          <TableCell colSpan={2} className="text-muted-foreground text-sm">
                            No matching inventory item
                          </TableCell>
                        </TableRow>
                      );
                    }
                    if (line.picks.length === 0) {
                      return (
                        <TableRow key={`${line.catalog_type}-${line.ingredient_name}`} className="bg-red-50">
                          <TableCell className="font-medium">{line.ingredient_name}</TableCell>
                          <TableCell className="text-right">
                            {line.converted_quantity.toFixed(2)} {unit}
                            {line.unit_mismatch && " (unit mismatch)"}
                          </TableCell>
                          <TableCell colSpan={2} className="text-muted-foreground text-sm">
                            No available lots
                          </TableCell>
                        </TableRow>
                      );
                    }
                    return line.picks.map((pick, pickIdx) => (
                      <TableRow key={`${lineIdx}-${pick.lot_id}`}>
                        <TableCell className="font-medium">
                          {pickIdx === 0 ? line.ingredient_name : ""}
                        </TableCell>
                        <TableCell className="text-right">
                          {pickIdx === 0 ? (
                            <>
                              {line.converted_quantity.toFixed(2)} {unit}
                              {line.unit_mismatch && (
                                <span className="text-yellow-700"> (unit mismatch)</span>
                              )}
                              {line.shortfall > 0 && (
                                <span className="text-destructive block text-xs">
                                  short {line.shortfall.toFixed(2)} {unit}
                                </span>
                              )}
                            </>
                          ) : (
                            ""
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{pick.lot_number ?? pick.lot_id.slice(0, 8)}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            className="h-8 w-28 text-right ml-auto"
                            value={pickQty(lineIdx, pick.lot_id, pick.quantity)}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              setEdits((prev) => ({
                                ...prev,
                                [`${lineIdx}:${pick.lot_id}`]: Number.isFinite(v) && v >= 0 ? v : 0,
                              }));
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    ));
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleSkip} disabled={confirmMutation.isPending}>
            Skip
          </Button>
          <Button
            type="button"
            onClick={() => confirmMutation.mutate()}
            disabled={confirmMutation.isPending || isLoading || !hasAnyPicks}
          >
            {confirmMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Planning...
              </>
            ) : (
              "Confirm Consumption"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
