"use client";

/**
 * PO Receiving
 *
 * Component for receiving purchase order line items into inventory.
 * Supports partial receives with lot numbers and expiration dates.
 * Creates inventory_lots records to track received materials.
 */

import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Package, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
  getCatalogTypeLabel,
  resolveCatalogNames,
} from "@/entities/po-line-item";
import { purchaseOrderEntity } from "@/entities/purchase-order";
import { purchaseOrderKeys } from "@/lib/query-keys";
import { log } from "@/lib/client-logger";

// =============================================================================
// Types
// =============================================================================

type POLineItemWithReceived = {
  id: string;
  catalog_type: string;
  catalog_id: string;
  catalog_name: string;
  quantity: number;
  unit: string;
  unit_price: number | null;
  received_quantity: number;
}

type ReceiveEntry = {
  po_line_item_id: string;
  quantity: number;
  lot_number: string;
  expiration_date: string;
  notes: string;
}

type POReceivingProps = {
  poId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

// =============================================================================
// Helpers
// =============================================================================

function defaultReceiveEntry(itemId: string): ReceiveEntry {
  return {
    po_line_item_id: itemId,
    quantity: 0,
    lot_number: "",
    expiration_date: "",
    notes: "",
  };
}

function isValidTransition(fromState: string, toState: string): boolean {
  const stateMachine = purchaseOrderEntity.stateMachine;
  if (!stateMachine) return false;
  const validTransitions = stateMachine.transitions[fromState] || [];
  return validTransitions.includes(toState);
}

// =============================================================================
// Component
// =============================================================================

export function POReceiving({
  poId,
  open,
  onOpenChange,
  onSuccess,
}: POReceivingProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  // Track receive quantities per line item
  const [receives, setReceives] = useState<Record<string, ReceiveEntry>>({});

  // Fetch PO line items with received quantities and resolved catalog names
  const { data: lineItems, isLoading } = useQuery({
    queryKey: purchaseOrderKeys.lineItemsForReceive(poId),
    queryFn: async () => {
      // Get line items
      const { data: items, error: itemsError } = await supabase
        .from("po_line_items")
        .select("*")
        .eq("po_id", poId)
        .order("created_at", { ascending: true });

      if (itemsError) throw itemsError;

      // Get received quantities
      const { data: received, error: receivedError } = await supabase
        .from("po_receives")
        .select("po_line_item_id, quantity")
        .in(
          "po_line_item_id",
          items.map((i) => i.id)
        );

      if (receivedError) throw receivedError;

      // Calculate received quantity per line item
      const receivedByItem = new Map<string, number>();
      for (const r of received ?? []) {
        const current = receivedByItem.get(r.po_line_item_id) || 0;
        receivedByItem.set(r.po_line_item_id, current + r.quantity);
      }

      // Resolve catalog item names using shared utility
      const nameMap = await resolveCatalogNames(supabase, items);

      // Merge with resolved names
      return items.map((item) => ({
        ...item,
        catalog_name: nameMap.get(`${item.catalog_type}:${item.catalog_id}`) || item.catalog_id,
        received_quantity: receivedByItem.get(item.id) || 0,
      })) as POLineItemWithReceived[];
    },
    enabled: open,
  });

  // Create receive mutation
  const receiveMutation = useMutation({
    mutationFn: async (entries: ReceiveEntry[]) => {
      const receivesToInsert = entries
        .filter((e) => e.quantity > 0)
        .map((entry) => ({
          po_line_item_id: entry.po_line_item_id,
          quantity: entry.quantity,
          lot_number: entry.lot_number || null,
          expiration_date: entry.expiration_date || null,
          notes: entry.notes || null,
        }));

      if (receivesToInsert.length === 0) {
        throw new Error("No quantities to receive");
      }

      // Insert po_receives records
      const { error: receiveError } = await supabase
        .from("po_receives")
        .insert(receivesToInsert);

      if (receiveError) throw receiveError;

      // NOTE: Inventory lot creation is intentionally NOT done here.
      // PO receiving records what was physically received (po_receives with lot_number/expiration).
      // A separate inventory receiving workflow should create inventory_lots, allowing for:
      // - QA/inspection steps between receipt and inventory acceptance
      // - Proper mapping to inventory_items (which may not match catalog items 1:1)
      // - User control over which items enter inventory tracking
      // The po_receives.id can be linked via inventory_lots.po_receive_id when lots are created.

      // Get current PO status for state machine validation
      const { data: currentPO, error: poFetchError } = await supabase
        .from("purchase_orders")
        .select("status")
        .eq("id", poId)
        .single();

      if (poFetchError) throw poFetchError;

      const currentStatus = currentPO.status;

      // Re-query to get accurate totals after insert (fixes race condition)
      const { data: updatedItems, error: itemsError } = await supabase
        .from("po_line_items")
        .select("id, quantity")
        .eq("po_id", poId);

      if (itemsError) throw itemsError;

      const { data: allReceives, error: receivesError } = await supabase
        .from("po_receives")
        .select("po_line_item_id, quantity")
        .in(
          "po_line_item_id",
          updatedItems.map((i) => i.id)
        );

      if (receivesError) throw receivesError;

      // Calculate accurate totals from database
      const receivedByItem = new Map<string, number>();
      for (const r of allReceives ?? []) {
        const current = receivedByItem.get(r.po_line_item_id) || 0;
        receivedByItem.set(r.po_line_item_id, current + r.quantity);
      }

      const allFullyReceived = updatedItems.every((item) => {
        const totalReceived = receivedByItem.get(item.id) || 0;
        return totalReceived >= item.quantity;
      });

      // Determine target status based on whether all items are received
      const targetStatus = allFullyReceived ? "fulfilled" : "partial";

      // Validate state machine transition
      if (!isValidTransition(currentStatus, targetStatus)) {
        // If we can't transition to target, check if we're already in a valid state
        if (currentStatus === targetStatus) {
          // Already in the target state, no update needed
          return;
        }
        // Otherwise throw an error - this shouldn't happen in normal workflow
        throw new Error(
          `Cannot transition from "${currentStatus}" to "${targetStatus}". ` +
          `Valid transitions: ${purchaseOrderEntity.stateMachine?.transitions[currentStatus]?.join(", ") || "none"}`
        );
      }

      // Update PO status with error checking
      const { error: statusError } = await supabase
        .from("purchase_orders")
        .update({ status: targetStatus })
        .eq("id", poId);

      if (statusError) throw statusError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.lineItems(poId) });
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.lineItemsForReceive(poId) });
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.detail(poId) });
      toast.success("Items received successfully");
      setReceives({});
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      log.error("Receive error:", error);
      toast.error("Failed to receive items");
    },
  });

  // Handle quantity change
  const handleQuantityChange = (
    itemId: string,
    remaining: number,
    value: string
  ) => {
    const qty = parseFloat(value) || 0;
    const validQty = Math.min(Math.max(0, qty), remaining);

    setReceives((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || defaultReceiveEntry(itemId)),
        quantity: validQty,
      },
    }));
  };

  const handleFieldChange = (
    itemId: string,
    field: keyof ReceiveEntry,
    value: string
  ) => {
    setReceives((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || defaultReceiveEntry(itemId)),
        [field]: value,
      },
    }));
  };

  // Handle save
  const handleSave = () => {
    const entries = Object.values(receives).filter((e) => e.quantity > 0);

    if (entries.length === 0) {
      toast.error("Please enter at least one quantity to receive");
      return;
    }

    receiveMutation.mutate(entries);
  };

  // Calculate totals
  const totalReceiving = Object.values(receives).reduce(
    (sum, e) => sum + (e.quantity || 0),
    0
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Receive Items
          </DialogTitle>
          <DialogDescription>
            Enter quantities received for each line item. Partial receives are supported.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : lineItems && lineItems.length > 0 ? (
          <div className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead className="w-[100px]">Receive</TableHead>
                  <TableHead className="w-[120px]">Lot #</TableHead>
                  <TableHead className="w-[130px]">Expiration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lineItems.map((item) => {
                  const remaining = item.quantity - item.received_quantity;
                  const isFullyReceived = remaining <= 0;

                  return (
                    <TableRow
                      key={item.id}
                      className={isFullyReceived ? "opacity-50" : ""}
                    >
                      <TableCell>{getCatalogTypeLabel(item.catalog_type)}</TableCell>
                      <TableCell className="font-medium">
                        {item.catalog_name}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.quantity} {item.unit}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.received_quantity > 0 ? (
                          <Badge variant="outline">
                            {item.received_quantity} {item.unit}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {isFullyReceived ? (
                          <Badge variant="secondary">Complete</Badge>
                        ) : (
                          <span className="font-medium">
                            {remaining} {item.unit}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          min={0}
                          max={remaining}
                          value={receives[item.id]?.quantity || ""}
                          onChange={(e) =>
                            handleQuantityChange(item.id, remaining, e.target.value)
                          }
                          disabled={isFullyReceived}
                          className="h-8 w-full"
                          placeholder="0"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="text"
                          value={receives[item.id]?.lot_number || ""}
                          onChange={(e) =>
                            handleFieldChange(item.id, "lot_number", e.target.value)
                          }
                          disabled={isFullyReceived || !receives[item.id]?.quantity}
                          className="h-8 w-full"
                          placeholder="LOT-XXX"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="date"
                          value={receives[item.id]?.expiration_date || ""}
                          onChange={(e) =>
                            handleFieldChange(item.id, "expiration_date", e.target.value)
                          }
                          disabled={isFullyReceived || !receives[item.id]?.quantity}
                          className="h-8 w-full"
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {/* Notes section */}
            {totalReceiving > 0 && (
              <div className="space-y-2">
                <Label>Receiving Notes</Label>
                <Textarea
                  placeholder="Optional notes about this receive..."
                  className="min-h-[60px]"
                />
              </div>
            )}

            {/* Summary */}
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <span className="font-medium">Total Items to Receive</span>
              <Badge variant={totalReceiving > 0 ? "default" : "secondary"}>
                {Object.values(receives).filter((e) => e.quantity > 0).length} line items
              </Badge>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-muted-foreground">
              No line items on this purchase order.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="min-h-[44px]"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={receiveMutation.isPending || totalReceiving === 0}
            className="min-h-[44px]"
          >
            {receiveMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                Receive Items
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
