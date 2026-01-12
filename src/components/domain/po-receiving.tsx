"use client";

/**
 * POReceiving - Purchase Order Receiving Component
 *
 * Allows receiving items from a purchase order:
 * - Shows PO line items with ordered quantities
 * - Enter received quantities per line
 * - Lot number assignment
 * - Storage location selection
 * - Supports partial receives
 * - Creates inventory lots on receive
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Package, Loader2, CheckCircle2 } from "lucide-react";

// Types
interface POLineItem {
  id: string;
  catalog_type: string;
  catalog_id: string;
  quantity: number;
  unit: string;
  unit_price: number | null;
  // Calculated
  received_quantity: number;
  remaining_quantity: number;
  // Display name (fetched from catalog)
  item_name?: string;
}

interface ReceiveEntry {
  line_item_id: string;
  quantity: number;
  lot_number: string;
  location: string;
  expiration_date: string | null;
  notes: string;
}

interface POReceivingProps {
  /** Purchase Order ID */
  poId: string;
  /** Current PO status */
  poStatus: string;
  /** Callback when receiving completes */
  onReceiveComplete?: () => void;
}

export function POReceiving({ poId, poStatus, onReceiveComplete }: POReceivingProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [receiveEntries, setReceiveEntries] = useState<Record<string, ReceiveEntry>>({});
  const queryClient = useQueryClient();
  const supabase = createClient();

  // Fetch PO line items with receive history
  const { data: lineItems = [], isLoading } = useQuery({
    queryKey: ["po-line-items", poId],
    queryFn: async () => {
      // Get line items
      const { data: items, error: itemsError } = await supabase
        .from("po_line_items")
        .select("*")
        .eq("po_id", poId);
      if (itemsError) throw itemsError;

      // Get receive history
      const { data: receives, error: receivesError } = await supabase
        .from("po_receives")
        .select("*")
        .in("po_line_item_id", items.map((i) => i.id));
      if (receivesError) throw receivesError;

      // Calculate received quantities
      const receivedByLine = (receives || []).reduce((acc, r) => {
        acc[r.po_line_item_id] = (acc[r.po_line_item_id] || 0) + Number(r.quantity);
        return acc;
      }, {} as Record<string, number>);

      // Fetch item names from catalog tables
      const itemsWithNames = await Promise.all(
        items.map(async (item) => {
          let itemName = "Unknown Item";
          try {
            // Use dynamic table based on catalog_type
            const tableName = item.catalog_type === "hop" ? "hops" : `${item.catalog_type}s`;
            const { data } = await (supabase as unknown as {
              from: (table: string) => {
                select: (fields: string) => {
                  eq: (field: string, value: string) => {
                    single: () => Promise<{ data: { name: string } | null }>;
                  };
                };
              };
            })
              .from(tableName)
              .select("name")
              .eq("id", item.catalog_id)
              .single();
            if (data) itemName = data.name;
          } catch {
            // Catalog item not found
          }

          const received = receivedByLine[item.id] || 0;
          return {
            ...item,
            received_quantity: received,
            remaining_quantity: Number(item.quantity) - received,
            item_name: itemName,
          } as POLineItem;
        })
      );

      return itemsWithNames;
    },
    enabled: isOpen,
  });

  // Calculate totals
  const totals = useMemo(() => {
    const totalOrdered = lineItems.reduce((sum, item) => sum + Number(item.quantity), 0);
    const totalReceived = lineItems.reduce((sum, item) => sum + item.received_quantity, 0);
    const totalRemaining = lineItems.reduce((sum, item) => sum + item.remaining_quantity, 0);
    return { totalOrdered, totalReceived, totalRemaining };
  }, [lineItems]);

  // Check if there are any entries to receive
  const hasEntries = useMemo(() => {
    return Object.values(receiveEntries).some((e) => e.quantity > 0);
  }, [receiveEntries]);

  // Handle receive entry change
  const handleEntryChange = (lineItemId: string, field: keyof ReceiveEntry, value: unknown) => {
    setReceiveEntries((prev) => ({
      ...prev,
      [lineItemId]: {
        ...(prev[lineItemId] || {
          line_item_id: lineItemId,
          quantity: 0,
          lot_number: "",
          location: "",
          expiration_date: null,
          notes: "",
        }),
        [field]: value,
      },
    }));
  };

  // Submit receive
  const receiveMutation = useMutation({
    mutationFn: async () => {
      const entries = Object.values(receiveEntries).filter((e) => e.quantity > 0);
      if (entries.length === 0) {
        throw new Error("No items to receive");
      }

      // Create po_receives records
      for (const entry of entries) {
        const { error: receiveError } = await supabase.from("po_receives").insert({
          po_line_item_id: entry.line_item_id,
          quantity: entry.quantity,
          lot_number: entry.lot_number || null,
          expiration_date: entry.expiration_date || null,
          notes: entry.notes || null,
          received_date: new Date().toISOString().slice(0, 10),
        });
        if (receiveError) throw receiveError;

        // Find the line item to get catalog info
        const lineItem = lineItems.find((li) => li.id === entry.line_item_id);
        if (lineItem) {
          // Find or create inventory item for this catalog item
          // First check if inventory_item exists
          const { data: existingItem } = await (supabase as unknown as {
            from: (table: string) => {
              select: (fields: string) => {
                eq: (field: string, value: string) => {
                  eq: (field: string, value: string) => {
                    single: () => Promise<{ data: { id: string } | null }>;
                  };
                };
              };
            };
          })
            .from("inventory_items")
            .select("id")
            .eq("catalog_type", lineItem.catalog_type)
            .eq("catalog_id", lineItem.catalog_id)
            .single();

          let inventoryItemId = existingItem?.id;

          if (!inventoryItemId) {
            // Create inventory item
            const { data: newItem, error: itemError } = await supabase
              .from("inventory_items")
              .insert({
                name: lineItem.item_name || "Unknown",
                catalog_type: lineItem.catalog_type,
                catalog_id: lineItem.catalog_id,
                unit: lineItem.unit,
              } as never)
              .select("id")
              .single();
            if (itemError) throw itemError;
            inventoryItemId = newItem?.id;
          }

          if (inventoryItemId) {
            // Create inventory lot
            const { error: lotError } = await supabase.from("inventory_lots").insert({
              inventory_item_id: inventoryItemId,
              lot_number: entry.lot_number || null,
              quantity: entry.quantity,
              unit: lineItem.unit,
              unit_cost: lineItem.unit_price,
              received_date: new Date().toISOString().slice(0, 10),
              expiration_date: entry.expiration_date || null,
              location: entry.location || null,
              notes: entry.notes || null,
            } as never);
            if (lotError) throw lotError;
          }
        }
      }

      // Check if PO is fully received and update status
      const updatedLineItems = await Promise.all(
        lineItems.map(async (item) => {
          const entry = entries.find((e) => e.line_item_id === item.id);
          const additionalQty = entry?.quantity || 0;
          const newReceived = item.received_quantity + additionalQty;
          const newRemaining = Number(item.quantity) - newReceived;
          return { ...item, remaining_quantity: newRemaining };
        })
      );

      const allReceived = updatedLineItems.every((item) => item.remaining_quantity <= 0);
      const someReceived = updatedLineItems.some((item) => item.remaining_quantity < Number(item.quantity));

      // Update PO status
      if (allReceived) {
        await supabase
          .from("purchase_orders")
          .update({ status: "fulfilled" })
          .eq("id", poId);
      } else if (someReceived && poStatus === "confirmed") {
        await supabase
          .from("purchase_orders")
          .update({ status: "partial" })
          .eq("id", poId);
      }

      return { allReceived };
    },
    onSuccess: (result) => {
      toast.success(
        result.allReceived
          ? "PO fully received and fulfilled!"
          : "Items received successfully"
      );
      queryClient.invalidateQueries({ queryKey: ["po-line-items", poId] });
      queryClient.invalidateQueries({ queryKey: ["purchase_orders", poId] });
      queryClient.invalidateQueries({ queryKey: ["inventory_lots"] });
      setReceiveEntries({});
      setIsOpen(false);
      onReceiveComplete?.();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to receive items");
    },
  });

  // Can only receive if PO is in confirmed or partial status
  const canReceive = ["confirmed", "partial"].includes(poStatus);

  if (!canReceive) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="default" className="gap-2">
          <Package className="h-4 w-4" />
          Receive Items
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Receive Purchase Order Items</DialogTitle>
          <DialogDescription>
            Enter quantities received, lot numbers, and storage locations.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : lineItems.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No line items on this purchase order.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            <div className="flex gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Ordered:</span>{" "}
                <span className="font-medium">{totals.totalOrdered}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Received:</span>{" "}
                <span className="font-medium">{totals.totalReceived}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Remaining:</span>{" "}
                <span className="font-medium">{totals.totalRemaining}</span>
              </div>
            </div>

            <Separator />

            {/* Line Items */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right w-24">Ordered</TableHead>
                  <TableHead className="text-right w-24">Received</TableHead>
                  <TableHead className="text-right w-24">Remaining</TableHead>
                  <TableHead className="w-24">Receive Qty</TableHead>
                  <TableHead className="w-32">Lot #</TableHead>
                  <TableHead className="w-32">Location</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lineItems.map((item) => {
                  const entry = receiveEntries[item.id];
                  const isFullyReceived = item.remaining_quantity <= 0;

                  return (
                    <TableRow key={item.id} className={isFullyReceived ? "opacity-50" : ""}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{item.item_name}</div>
                          <div className="text-xs text-muted-foreground">
                            {item.catalog_type} • {item.unit}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {item.quantity}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {item.received_quantity}
                      </TableCell>
                      <TableCell className="text-right">
                        {isFullyReceived ? (
                          <Badge variant="outline" className="gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Complete
                          </Badge>
                        ) : (
                          <span className="tabular-nums">{item.remaining_quantity}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {!isFullyReceived && (
                          <Input
                            type="number"
                            min="0"
                            max={item.remaining_quantity}
                            step="0.01"
                            value={entry?.quantity || ""}
                            onChange={(e) =>
                              handleEntryChange(
                                item.id,
                                "quantity",
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="w-20 text-right"
                            placeholder="0"
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        {!isFullyReceived && (
                          <Input
                            type="text"
                            value={entry?.lot_number || ""}
                            onChange={(e) =>
                              handleEntryChange(item.id, "lot_number", e.target.value)
                            }
                            className="w-28"
                            placeholder="Lot #"
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        {!isFullyReceived && (
                          <Input
                            type="text"
                            value={entry?.location || ""}
                            onChange={(e) =>
                              handleEntryChange(item.id, "location", e.target.value)
                            }
                            className="w-28"
                            placeholder="Location"
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => receiveMutation.mutate()}
            disabled={!hasEntries || receiveMutation.isPending}
          >
            {receiveMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Receive Items
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
