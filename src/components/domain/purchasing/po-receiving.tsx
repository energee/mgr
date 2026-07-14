"use client";

/**
 * PO Receiving
 *
 * Bulk-receive dialog for purchase order line items, opened by the
 * "Receive Items" action on the PO detail page (pos/[id]/page.tsx).
 * Records po_receives rows (partial receives supported) with lot numbers and
 * expiration dates, then flips the PO to partial/fulfilled based on received
 * totals. Inventory lots are NOT created here — the downstream
 * "Accept into Inventory" flow turns unaccepted receives into inventory_lots.
 *
 * Quantity cells include a bundles × per-bundle helper (popover) for suppliers
 * that ship in bundles (e.g., 10 stacks × 250 trays); only the computed
 * single-unit quantity is persisted.
 */

import { useState, useEffect } from "react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Loader2, Package, Check, AlertCircle, Boxes } from "lucide-react";
import { toast } from "sonner";
import {
  getCatalogTypeLabel,
  resolveCatalogNames,
} from "@/entities/po-line-item";
import { purchaseOrderKeys, entityKeys } from "@/lib/query-keys";
import { parsePositiveNumber } from "@/lib/format";
import { log } from "@/lib/client-logger";
import { receivePurchaseOrderItems } from "@/services/po-receiving-service";

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

/** Ephemeral per-row bundles × per-bundle inputs (not persisted — only the
 *  computed single-unit quantity goes to po_receives). */
type BundleEntry = {
  bundles: string;
  perBundle: string;
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
  // Per-row bundle helper inputs (keyed by line item id)
  const [bundleInputs, setBundleInputs] = useState<Record<string, BundleEntry>>({});
  const [globalNotes, setGlobalNotes] = useState("");

  // Reset state when dialog opens (clean slate for each session)
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- dialog reset on open is intentional
      setReceives({});
      setBundleInputs({});
      setGlobalNotes("");
    }
  }, [open]);

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
    // The receipt rules (fulfilled/partial decision, transition validation, write order)
    // live in @/services/po-receiving-service, not here — see that file for the known
    // non-atomicity of the insert-then-validate sequence.
    mutationFn: async (entries: ReceiveEntry[]) => {
      await receivePurchaseOrderItems(supabase, { poId, entries, globalNotes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.lineItems(poId) });
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.lineItemsForReceive(poId) });
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.detail(poId) });
      // The generic detail page caches under entityKeys — refresh so the
      // status badge reflects the partial/fulfilled flip immediately.
      queryClient.invalidateQueries({ queryKey: entityKeys.all("purchase_orders") });
      toast.success("Items received successfully");
      setReceives({});
      setBundleInputs({});
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      log.error("Receive error:", error);
      // NOTE: PO receiving inserts all po_receives rows in a single batch insert,
      // so partial failures at the insert stage are unlikely. However, subsequent
      // status update or re-query steps can still fail after the insert succeeds.
      // A future improvement would be to wrap the entire receive flow (insert +
      // status update) in a server-side RPC for true atomicity.
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Failed to receive items: ${message}`, {
        description: "Some records may have been saved. Please refresh and verify.",
        duration: 8000,
      });
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

  // Bundle helper: when both inputs parse as positive numbers, auto-fill the
  // row's quantity with bundles × per-bundle (clamped to remaining by
  // handleQuantityChange).
  const handleBundleChange = (
    itemId: string,
    remaining: number,
    patch: Partial<BundleEntry>
  ) => {
    const next = { ...(bundleInputs[itemId] ?? { bundles: "", perBundle: "" }), ...patch };
    setBundleInputs((prev) => ({ ...prev, [itemId]: next }));

    const bundles = parsePositiveNumber(next.bundles);
    const perBundle = parsePositiveNumber(next.perBundle);
    if (bundles !== null && perBundle !== null) {
      handleQuantityChange(itemId, remaining, String(bundles * perBundle));
    }
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
                        <div className="flex items-center gap-1">
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
                          {/* Bundles × per-bundle entry helper */}
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                disabled={isFullyReceived}
                                aria-label="Enter quantity as bundles"
                              >
                                <Boxes className="h-4 w-4" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-72 space-y-2" align="end">
                              <p className="text-sm font-medium">Received in bundles</p>
                              <div className="flex items-center gap-2">
                                <Input
                                  type="number"
                                  inputMode="numeric"
                                  min="0"
                                  step="1"
                                  placeholder="Bundles"
                                  aria-label="Number of bundles"
                                  value={bundleInputs[item.id]?.bundles ?? ""}
                                  onChange={(e) =>
                                    handleBundleChange(item.id, remaining, {
                                      bundles: e.target.value,
                                    })
                                  }
                                  className="h-8 w-24"
                                />
                                <span className="text-sm text-muted-foreground">×</span>
                                <Input
                                  type="number"
                                  inputMode="numeric"
                                  min="0"
                                  step="1"
                                  placeholder="Per bundle"
                                  aria-label="Units per bundle"
                                  value={bundleInputs[item.id]?.perBundle ?? ""}
                                  onChange={(e) =>
                                    handleBundleChange(item.id, remaining, {
                                      perBundle: e.target.value,
                                    })
                                  }
                                  className="h-8 w-24"
                                />
                              </div>
                              {(() => {
                                const b = parsePositiveNumber(bundleInputs[item.id]?.bundles ?? "");
                                const p = parsePositiveNumber(bundleInputs[item.id]?.perBundle ?? "");
                                const total = b !== null && p !== null ? b * p : null;
                                return (
                                  <p className="text-xs text-muted-foreground tabular-nums">
                                    = {total !== null ? total.toLocaleString() : "—"} {item.unit}
                                    {total !== null && total > remaining
                                      ? ` (capped at ${remaining} remaining)`
                                      : ""}
                                  </p>
                                );
                              })()}
                            </PopoverContent>
                          </Popover>
                        </div>
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
                  value={globalNotes}
                  onChange={(e) => setGlobalNotes(e.target.value)}
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
