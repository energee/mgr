"use client";

/**
 * Ship Transfer Dialog
 *
 * Allows partial or full shipment of a location transfer. Shows each transfer
 * line with its requested quantity and an editable "shipped quantity" input.
 * Calls the `ship_transfer_partial` RPC which handles:
 * - Full shipment: sets transfer to in_transit
 * - Partial shipment: sets transfer to partial, creates remainder transfer
 */

import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Loader2, Truck, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { transferKeys, entityKeys } from "@/lib/query-keys";

// =============================================================================
// Types
// =============================================================================

interface TransferLine {
  id: string;
  finished_good_id: string | null;
  inventory_lot_id: string | null;
  quantity: number;
  /** Resolved display name for the line item */
  item_name: string;
}

interface ShipTransferDialogProps {
  transferId: string;
  open: boolean;
  onClose: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function ShipTransferDialog({
  transferId,
  open,
  onClose,
}: ShipTransferDialogProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  // Per-line shipped quantity overrides keyed by line ID.
  // When empty, defaults to full quantity from query data.
  const [quantityOverrides, setQuantityOverrides] = useState<
    Record<string, number>
  >({});

  // Fetch transfer lines with item names
  const { data: lines, isLoading } = useQuery({
    queryKey: transferKeys.lines(transferId),
    queryFn: async () => {
      // Fetch transfer lines
      const { data: rawLines, error } = await supabase
        .from("transfer_lines")
        .select("id, finished_good_id, inventory_lot_id, quantity")
        .eq("transfer_id", transferId)
        .order("created_at");

      if (error) throw error;
      if (!rawLines || rawLines.length === 0) return [] as TransferLine[];

      // Resolve item names — finished goods via brands, inventory lots via items
      const fgIds = rawLines
        .filter((l) => l.finished_good_id)
        .map((l) => l.finished_good_id!);
      const lotIds = rawLines
        .filter((l) => l.inventory_lot_id)
        .map((l) => l.inventory_lot_id!);

      const nameMap = new Map<string, string>();

      // Resolve FG and lot names in parallel (independent lookups)
      const [fgResult, lotResult] = await Promise.all([
        fgIds.length > 0
          ? supabase
              .from("finished_goods_with_availability")
              .select("id, brand_name, selling_format_name, lot_number")
              .in("id", fgIds)
          : Promise.resolve({ data: null, error: null }),
        lotIds.length > 0
          ? supabase
              .from("inventory_lots")
              .select("id, lot_number, inventory_item:inventory_items(name)")
              .in("id", lotIds)
          : Promise.resolve({ data: null, error: null }),
      ]);

      for (const fg of fgResult.data ?? []) {
        const parts = [
          fg.brand_name,
          fg.selling_format_name,
          fg.lot_number ? `(${fg.lot_number})` : null,
        ].filter(Boolean);
        nameMap.set(`fg:${fg.id}`, parts.join(" - "));
      }

      if (lotResult.data && lotResult.data.length > 0) {
        for (const lot of lotResult.data) {
          const item = lot.inventory_item as { name: string } | null;
          const itemName = item?.name ?? "Unknown Item";
          const display = lot.lot_number
            ? `${itemName} (${lot.lot_number})`
            : itemName;
          nameMap.set(`lot:${lot.id}`, display);
        }
      }

      return rawLines.map((line) => {
        let itemName = "Unknown Item";
        if (line.finished_good_id) {
          itemName =
            nameMap.get(`fg:${line.finished_good_id}`) ?? "Finished Good";
        } else if (line.inventory_lot_id) {
          itemName =
            nameMap.get(`lot:${line.inventory_lot_id}`) ?? "Inventory Lot";
        }

        return {
          ...line,
          item_name: itemName,
        };
      });
    },
    enabled: open,
  });

  // Derive shipped quantities: use overrides if present, else default to full quantity
  const shippedQuantities = useMemo(() => {
    if (!lines) return {} as Record<string, number>;
    const result: Record<string, number> = {};
    for (const line of lines) {
      result[line.id] = quantityOverrides[line.id] ?? line.quantity;
    }
    return result;
  }, [lines, quantityOverrides]);

  const updateQuantity = useCallback((lineId: string, value: number) => {
    setQuantityOverrides((prev) => ({
      ...prev,
      [lineId]: value,
    }));
  }, []);

  // Check if this is a partial shipment
  const isPartial = useMemo(() => {
    if (!lines) return false;
    return lines.some(
      (line) => (shippedQuantities[line.id] ?? line.quantity) < line.quantity
    );
  }, [lines, shippedQuantities]);

  // Validation
  const canSubmit = useMemo(() => {
    if (!lines || lines.length === 0) return false;
    // At least one line must have quantity > 0
    const hasShipped = lines.some(
      (line) => (shippedQuantities[line.id] ?? 0) > 0
    );
    // No line can exceed its requested quantity or be negative
    const allValid = lines.every((line) => {
      const shipped = shippedQuantities[line.id] ?? 0;
      return shipped >= 0 && shipped <= line.quantity;
    });
    return hasShipped && allValid;
  }, [lines, shippedQuantities]);

  // Ship mutation
  const shipMutation = useMutation({
    mutationFn: async () => {
      if (!lines) throw new Error("No lines to ship");

      const lineQuantities = lines.map((line) => ({
        line_id: line.id,
        quantity_shipped: shippedQuantities[line.id] ?? 0,
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)(
        "ship_transfer_partial",
        {
          p_transfer_id: transferId,
          p_line_quantities: lineQuantities,
        }
      ) as { data: string | null; error: Error | null };

      if (error) throw error;
      return data as string | null; // remainder transfer ID or null
    },
    onSuccess: (remainderId) => {
      if (remainderId) {
        toast.success("Transfer partially shipped", {
          description: "A remainder transfer was created for unshipped items.",
          action: {
            label: "View Remainder",
            onClick: () => {
              window.location.href = `/inventory/transfers/${remainderId}`;
            },
          },
        });
      } else {
        toast.success("Transfer shipped successfully");
      }

      // Invalidate caches
      queryClient.invalidateQueries({
        queryKey: transferKeys.all(),
      });
      queryClient.invalidateQueries({
        queryKey: entityKeys.all("location_transfers"),
      });
      queryClient.invalidateQueries({
        queryKey: entityKeys.all("location_transfers_with_details"),
      });
      queryClient.invalidateQueries({
        queryKey: transferKeys.detail(transferId),
      });
      queryClient.invalidateQueries({
        queryKey: transferKeys.lines(transferId),
      });

      setQuantityOverrides({});
      onClose();
    },
    onError: (error) => {
      console.error("Ship transfer error:", error);
      toast.error("Failed to ship transfer", {
        description:
          error instanceof Error ? error.message : "An error occurred",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            Ship Transfer
          </DialogTitle>
          <DialogDescription>
            Enter shipped quantities for each line. Lines with less than the
            requested quantity will create a remainder transfer.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : lines && lines.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right w-[120px]">
                    Requested
                  </TableHead>
                  <TableHead className="w-[140px]">Shipped</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => {
                  const shipped = shippedQuantities[line.id] ?? 0;
                  const isLinePartial = shipped < line.quantity;

                  return (
                    <TableRow key={line.id}>
                      <TableCell className="font-medium">
                        {line.item_name}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.quantity}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          max={line.quantity}
                          value={shipped}
                          onChange={(e) =>
                            updateQuantity(
                              line.id,
                              Math.max(
                                0,
                                Math.min(
                                  line.quantity,
                                  parseInt(e.target.value, 10) || 0
                                )
                              )
                            )
                          }
                          className={`h-8 w-[100px] tabular-nums ${
                            isLinePartial
                              ? "border-yellow-500 focus-visible:ring-yellow-500"
                              : ""
                          }`}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {isPartial && (
              <div className="flex items-start gap-2 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950 dark:text-yellow-200">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <p>
                  This is a partial shipment. A new transfer will be created
                  automatically for the unshipped quantities.
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-muted-foreground">
              No line items found for this transfer.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            className="min-h-[44px]"
          >
            Cancel
          </Button>
          <Button
            onClick={() => shipMutation.mutate()}
            disabled={!canSubmit || shipMutation.isPending}
            className="min-h-[44px]"
          >
            {shipMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Shipping...
              </>
            ) : (
              <>
                <Truck className="h-4 w-4 mr-2" />
                {isPartial ? "Ship Partial" : "Ship All"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
