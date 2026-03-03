"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  entityKeys,
  changeRequestKeys,
  inventoryKeys,
} from "@/lib/query-keys";
import { usePortalCustomer } from "@/lib/portal-context";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrderItem {
  id: string;
  brand_id: string;
  selling_format_id: string | null;
  quantity: number;
  unit_price: number;
  brands: { id: string; name: string } | null;
  selling_formats: { id: string; name: string } | null;
}

interface FinishedGoodAvailability {
  brand_id: string;
  selling_format_id: string | null;
  available_quantity: number;
  brands: { id: string; name: string } | null;
  selling_formats: { id: string; name: string } | null;
}

interface ItemChange {
  changeType: "modify" | "remove" | "add" | null;
  orderItemId?: string;
  brandId: string;
  brandName: string;
  sellingFormatId?: string;
  sellingFormatName?: string;
  originalQuantity?: number;
  proposedQuantity: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatName(item: ItemChange): string {
  return item.brandName;
}

function formatType(item: ItemChange): string {
  return item.sellingFormatName || "-";
}

function availabilityKey(
  brandId: string,
  sellingFormatId?: string
): string {
  return `${brandId}|${sellingFormatId ?? ""}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChangeRequestBuilder({ orderId }: { orderId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const supabase = createClient();
  usePortalCustomer();

  const [changes, setChanges] = useState<ItemChange[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [notes, setNotes] = useState("");
  const [addingItem, setAddingItem] = useState(false);
  const [newItemKey, setNewItemKey] = useState<string>("");
  const [newItemQty, setNewItemQty] = useState(1);

  // ---- Query: Order Items ----
  const { data: orderItems, isLoading: orderLoading } = useQuery<OrderItem[]>({
    queryKey: entityKeys.detail("orders", orderId),
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { data, error } = await db
        .from("order_items")
        .select(
          "id, brand_id, selling_format_id, quantity, unit_price, brands(id, name), selling_formats(id, name)"
        )
        .eq("order_id", orderId);
      if (error) throw error;
      return data;
    },
    enabled: !!orderId,
  });

  // ---- Query: Available Finished Goods ----
  const { data: availableGoods } = useQuery<FinishedGoodAvailability[]>({
    queryKey: inventoryKeys.finishedGoodsAvailable(),
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { data, error } = await db
        .from("finished_goods_with_availability")
        .select(
          "brand_id, selling_format_id, available_quantity, brands(id, name), selling_formats(id, name)"
        )
        .gt("available_quantity", 0);
      if (error) throw error;
      return data;
    },
  });

  // ---- Initialize changes from order items ----
  if (orderItems && !initialized) {
    setChanges(
      orderItems.map((item) => ({
        changeType: null,
        orderItemId: item.id,
        brandId: item.brand_id,
        brandName: item.brands?.name ?? "Unknown",
        sellingFormatId: item.selling_format_id ?? undefined,
        sellingFormatName: item.selling_formats?.name ?? undefined,
        originalQuantity: item.quantity,
        proposedQuantity: item.quantity,
      }))
    );
    setInitialized(true);
  }

  // ---- Availability lookup map ----
  const availabilityMap = useMemo(() => {
    const map = new Map<string, number>();
    if (availableGoods) {
      for (const fg of availableGoods) {
        const key = availabilityKey(
          fg.brand_id,
          fg.selling_format_id ?? undefined
        );
        map.set(key, fg.available_quantity);
      }
    }
    return map;
  }, [availableGoods]);

  // ---- Compute max quantities ----
  function getMaxQuantity(item: ItemChange): number {
    const key = availabilityKey(
      item.brandId,
      item.sellingFormatId
    );
    const available = availabilityMap.get(key) ?? 0;
    if (item.orderItemId && item.originalQuantity != null) {
      // Existing item: can go up to current + available unallocated
      return item.originalQuantity + available;
    }
    // New item: capped at available
    return available;
  }

  // ---- Handlers ----
  function handleQuantityChange(index: number, value: number) {
    setChanges((prev) => {
      const updated = [...prev];
      const item = { ...updated[index] };
      const qty = Math.max(0, value);
      item.proposedQuantity = qty;

      if (item.orderItemId) {
        // Existing item
        if (qty === 0) {
          item.changeType = "remove";
        } else if (qty !== item.originalQuantity) {
          item.changeType = "modify";
        } else {
          item.changeType = null;
        }
      }

      updated[index] = item;
      return updated;
    });
  }

  function handleRemove(index: number) {
    const item = changes[index];
    if (item.orderItemId) {
      // Existing item: set quantity to 0
      handleQuantityChange(index, 0);
    } else {
      // New item: just remove from list
      setChanges((prev) => prev.filter((_, i) => i !== index));
    }
  }

  function handleUndoRemove(index: number) {
    setChanges((prev) => {
      const updated = [...prev];
      const item = { ...updated[index] };
      item.proposedQuantity = item.originalQuantity ?? 0;
      item.changeType = null;
      updated[index] = item;
      return updated;
    });
  }

  // ---- Available items for adding (not already in changes) ----
  const addableItems = useMemo(() => {
    if (!availableGoods) return [];
    const existingKeys = new Set(
      changes.map((c) =>
        availabilityKey(c.brandId, c.sellingFormatId)
      )
    );
    return availableGoods.filter((fg) => {
      const key = availabilityKey(
        fg.brand_id,
        fg.selling_format_id ?? undefined
      );
      return !existingKeys.has(key);
    });
  }, [availableGoods, changes]);

  function handleAddItem() {
    if (!newItemKey) return;
    const fg = addableItems.find((item) => {
      const key = availabilityKey(
        item.brand_id,
        item.selling_format_id ?? undefined
      );
      return key === newItemKey;
    });
    if (!fg) return;

    const maxQty = fg.available_quantity;
    const qty = Math.min(Math.max(1, newItemQty), maxQty);

    setChanges((prev) => [
      ...prev,
      {
        changeType: "add",
        brandId: fg.brand_id,
        brandName: fg.brands?.name ?? "Unknown",
        sellingFormatId: fg.selling_format_id ?? undefined,
        sellingFormatName: fg.selling_formats?.name ?? undefined,
        proposedQuantity: qty,
      },
    ]);

    setAddingItem(false);
    setNewItemKey("");
    setNewItemQty(1);
  }

  // ---- Actual changes to submit ----
  const actualChanges = changes.filter((c) => c.changeType !== null);
  const hasChanges = actualChanges.length > 0;

  // ---- Change summary ----
  const changeSummary = actualChanges.map((c) => {
    const product = formatName(c);
    const format = formatType(c);
    const label = `${product} ${format}`;
    switch (c.changeType) {
      case "modify":
        return `${label}: ${c.originalQuantity} -> ${c.proposedQuantity} (${c.proposedQuantity - (c.originalQuantity ?? 0) > 0 ? "+" : ""}${c.proposedQuantity - (c.originalQuantity ?? 0)})`;
      case "remove":
        return `${label}: Remove (was ${c.originalQuantity})`;
      case "add":
        return `${label}: Add ${c.proposedQuantity}`;
      default:
        return "";
    }
  });

  // ---- Submit Mutation ----
  const mutation = useMutation({
    mutationFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;

      // 1. Create the change request
      const { data: request, error: reqError } = await db
        .from("order_change_requests")
        .insert({
          order_id: orderId,
          requested_by: (await supabase.auth.getUser()).data.user?.id,
          notes: notes || null,
        })
        .select("id")
        .single();

      if (reqError) throw reqError;

      // 2. Create change request items (only for items that actually changed)
      const items = actualChanges.map((c) => ({
        change_request_id: request.id,
        change_type: c.changeType,
        order_item_id: c.orderItemId || null,
        brand_id: c.brandId,
        selling_format_id: c.sellingFormatId || null,
        quantity: c.proposedQuantity,
        original_quantity: c.originalQuantity ?? null,
      }));

      if (items.length > 0) {
        const { error: itemsError } = await db
          .from("order_change_request_items")
          .insert(items);
        if (itemsError) throw itemsError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: changeRequestKeys.forOrder(orderId),
      });
      toast.success("Change request submitted");
      router.push(`/portal/orders/${orderId}`);
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to submit change request"
      );
    },
  });

  // ---- Loading State ----
  if (orderLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-64" />
        </div>
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  if (!orderItems) {
    return (
      <div className="space-y-4">
        <Link
          href={`/portal/orders/${orderId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Order
        </Link>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Order not found.
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- Render ----
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href={`/portal/orders/${orderId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Order
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Request Changes
        </h1>
      </div>

      {/* Current Items */}
      <Card>
        <CardHeader>
          <CardTitle>Current Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Format</TableHead>
                <TableHead className="text-right">Current Qty</TableHead>
                <TableHead className="text-right">Proposed Qty</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {changes.map((item, index) => {
                const isRemoved = item.changeType === "remove";
                const isNew = !item.orderItemId;
                const maxQty = getMaxQuantity(item);

                return (
                  <TableRow
                    key={item.orderItemId ?? `new-${index}`}
                    className={isRemoved ? "opacity-50" : undefined}
                  >
                    <TableCell className="font-medium">
                      {formatName(item)}
                      {isNew && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (new)
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{formatType(item)}</TableCell>
                    <TableCell className="text-right">
                      {item.originalQuantity ?? "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      {isRemoved ? (
                        <span className="text-sm text-destructive">
                          Removed
                        </span>
                      ) : (
                        <Input
                          type="number"
                          min={0}
                          max={maxQty}
                          value={item.proposedQuantity}
                          onChange={(e) =>
                            handleQuantityChange(
                              index,
                              Math.min(parseInt(e.target.value) || 0, maxQty)
                            )
                          }
                          className="ml-auto w-24 text-right"
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {isRemoved ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleUndoRemove(index)}
                        >
                          Undo
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemove(index)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add Item */}
      <Card>
        <CardContent className="pt-6">
          {addingItem ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <Label htmlFor="add-item-select">Product / Format</Label>
                  <Select value={newItemKey} onValueChange={setNewItemKey}>
                    <SelectTrigger id="add-item-select">
                      <SelectValue placeholder="Select a product..." />
                    </SelectTrigger>
                    <SelectContent>
                      {addableItems.map((fg) => {
                        const key = availabilityKey(
                          fg.brand_id,
                          fg.selling_format_id ?? undefined
                        );
                        const name = fg.brands?.name ?? "Unknown";
                        const format =
                          fg.selling_formats?.name || "Unknown";
                        return (
                          <SelectItem key={key} value={key}>
                            {name} - {format} (
                            {fg.available_quantity} available)
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="add-item-qty">Quantity</Label>
                  <Input
                    id="add-item-qty"
                    type="number"
                    min={1}
                    max={
                      addableItems.find((fg) => {
                        const key = availabilityKey(
                          fg.brand_id,
                          fg.selling_format_id ?? undefined
                        );
                        return key === newItemKey;
                      })?.available_quantity ?? 999
                    }
                    value={newItemQty}
                    onChange={(e) =>
                      setNewItemQty(parseInt(e.target.value) || 1)
                    }
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleAddItem}
                  disabled={!newItemKey}
                >
                  Add
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setAddingItem(false);
                    setNewItemKey("");
                    setNewItemQty(1);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddingItem(true)}
              disabled={addableItems.length === 0}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Item
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Explain your changes..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </CardContent>
      </Card>

      {/* Summary of Changes */}
      <Card>
        <CardHeader>
          <CardTitle>Summary of Changes</CardTitle>
        </CardHeader>
        <CardContent>
          {hasChanges ? (
            <ul className="list-inside list-disc space-y-1 text-sm">
              {changeSummary.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No changes have been made yet.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Submit */}
      <div className="flex justify-end">
        <Button
          onClick={() => mutation.mutate()}
          disabled={!hasChanges || mutation.isPending}
        >
          {mutation.isPending ? "Submitting..." : "Submit Change Request"}
        </Button>
      </div>
    </div>
  );
}
