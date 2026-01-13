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
import { CATALOG_TYPES } from "@/entities/po-line-item";
import { purchaseOrderEntity } from "@/entities/purchase-order";

// =============================================================================
// Types
// =============================================================================

interface POLineItemWithReceived {
  id: string;
  catalog_type: string;
  catalog_id: string;
  quantity: number;
  unit: string;
  unit_price: number | null;
  received_quantity: number;
}

interface ReceiveEntry {
  po_line_item_id: string;
  catalog_type: string;
  catalog_id: string;
  quantity: number;
  unit: string;
  unit_price: number | null;
  lot_number: string;
  expiration_date: string;
  notes: string;
}

interface POReceivingProps {
  poId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Check if a state transition is valid per the state machine config.
 */
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

  // Fetch PO line items with received quantities
  const { data: lineItems, isLoading } = useQuery({
    queryKey: ["po-line-items-for-receive", poId],
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
      received?.forEach((r) => {
        const current = receivedByItem.get(r.po_line_item_id) || 0;
        receivedByItem.set(r.po_line_item_id, current + r.quantity);
      });

      // Merge
      return items.map((item) => ({
        ...item,
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

      // Insert po_receives and get the inserted records
      const { data: insertedReceives, error: receiveError } = await supabase
        .from("po_receives")
        .insert(receivesToInsert)
        .select("id, po_line_item_id, quantity, lot_number, expiration_date");

      if (receiveError) throw receiveError;

      // Create inventory_lots for each receive
      // First, look up inventory_items by catalog_type + catalog_id
      const entriesWithReceiveIds = entries.filter((e) => e.quantity > 0);

      for (const receive of insertedReceives || []) {
        const entry = entriesWithReceiveIds.find(
          (e) => e.po_line_item_id === receive.po_line_item_id
        );
        if (!entry) continue;

        // Look up inventory_item by name matching catalog item
        // Note: This requires inventory_items to be set up for the catalog items
        const { data: inventoryItem } = await supabase
          .from("inventory_items")
          .select("id, unit")
          .eq("name", entry.catalog_id) // catalog_id is stored as name for now
          .eq("is_active", true)
          .maybeSingle();

        if (inventoryItem) {
          const { error: lotError } = await supabase.from("inventory_lots").insert({
            inventory_item_id: inventoryItem.id,
            po_receive_id: receive.id,
            lot_number: receive.lot_number,
            quantity: receive.quantity,
            unit: entry.unit || inventoryItem.unit,
            unit_cost: entry.unit_price,
            received_date: new Date().toISOString().split("T")[0],
            expiration_date: receive.expiration_date,
          });

          if (lotError) {
            console.error("Failed to create inventory lot:", lotError);
            // Continue - don't fail the whole receive for lot creation issues
          }
        }
      }

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
      allReceives?.forEach((r) => {
        const current = receivedByItem.get(r.po_line_item_id) || 0;
        receivedByItem.set(r.po_line_item_id, current + r.quantity);
      });

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
      queryClient.invalidateQueries({ queryKey: ["po-line-items", poId] });
      queryClient.invalidateQueries({ queryKey: ["po-line-items-for-receive", poId] });
      queryClient.invalidateQueries({ queryKey: ["purchase-order", poId] });
      toast.success("Items received successfully");
      setReceives({});
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      console.error("Receive error:", error);
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
        ...(prev[itemId] || {
          po_line_item_id: itemId,
          quantity: 0,
          lot_number: "",
          expiration_date: "",
          notes: "",
        }),
        quantity: validQty,
      },
    }));
  };

  // Handle field change
  const handleFieldChange = (
    itemId: string,
    field: keyof ReceiveEntry,
    value: string
  ) => {
    setReceives((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || {
          po_line_item_id: itemId,
          quantity: 0,
          lot_number: "",
          expiration_date: "",
          notes: "",
        }),
        [field]: value,
      },
    }));
  };

  // Handle save
  const handleSave = () => {
    const rawEntries = Object.values(receives).filter((e) => e.quantity > 0);

    if (rawEntries.length === 0) {
      toast.error("Please enter at least one quantity to receive");
      return;
    }

    // Enrich entries with catalog info from line items
    const entries: ReceiveEntry[] = rawEntries.map((entry) => {
      const lineItem = lineItems?.find((li) => li.id === entry.po_line_item_id);
      return {
        ...entry,
        catalog_type: lineItem?.catalog_type || "",
        catalog_id: lineItem?.catalog_id || "",
        unit: lineItem?.unit || "",
        unit_price: lineItem?.unit_price || null,
      };
    });

    receiveMutation.mutate(entries);
  };

  // Calculate totals
  const totalReceiving = Object.values(receives).reduce(
    (sum, e) => sum + (e.quantity || 0),
    0
  );

  // Get type label
  const getTypeLabel = (type: string) =>
    CATALOG_TYPES.find((t) => t.value === type)?.label || type;

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
                      <TableCell>{getTypeLabel(item.catalog_type)}</TableCell>
                      <TableCell className="font-medium">
                        {item.catalog_id}
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

        <DialogFooter className="gap-2 sm:gap-0">
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
