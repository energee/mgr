/**
 * Portal order placement (Phase 4, node C2).
 *
 * Lets a portal customer create their own order. Until migration 00290 the
 * portal was read + lock only: a customer could read their orders and amend a
 * *staff-created* one through `submit_order_change_request`, but could not
 * create one. 00290 added a deliberately narrow customer INSERT policy on
 * `orders` / `order_items`, and this component is the UI over it.
 *
 * The RLS policy — not this component — is the contract, and every field below
 * is chosen to satisfy it. `WITH CHECK` rejects the insert outright if any of
 * these drift, so treat them as load-bearing rather than cosmetic:
 *
 *   - `order_number` is omitted entirely; 00290 gave the column a DEFAULT of
 *     `generate_next_order_number()` (SECURITY DEFINER, so the ORD- series is
 *     computed over all orders and not just the ones this customer can see).
 *   - `status` is pinned to 'draft', the staff-confirm state. A customer must
 *     not be able to create an order that is already confirmed or fulfillable.
 *   - `unit_price` is left NULL on every line. Staff price the order at confirm
 *     time via `get_price_for_customer`; a customer-supplied price would turn
 *     the portal into a price-setting surface.
 *   - `scheduled_date`, `fulfilled_date`, `delivery_id` and `is_export` are
 *     never sent, and `version` is left to its default of 1. (00290 pins
 *     `version = 1` because `increment_version()` is an unguarded
 *     `OLD.version + 1`: a row inserted at INT_MAX would make every later staff
 *     UPDATE raise 22003 and strand the order.)
 *
 * Quantities are capped against the same unallocated-stock figure the change
 * request builder uses — see `use-finished-good-availability.ts`, which both
 * surfaces share so they cannot drift on which rows count as available.
 * Availability is advisory: it is read at page load and staff confirm later,
 * so the authoritative check is the allocation step.
 *
 * Indicative pricing is deliberately NOT shown. `get_price_for_customer` reads
 * `pricing_tier_prices`, which portal customers cannot SELECT, so it would
 * resolve to null on every line and render as noise.
 *
 * Writes go through `dynamicFrom` rather than the typed client because
 * `src/types/supabase.ts` still types `orders.Insert.order_number` as required
 * — the generated types predate 00290's DEFAULT. Regenerating them is the real
 * fix; see the PR body.
 */
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom } from "@/services/types";
import { unwrap } from "@/lib/supabase/query-helpers";
import { portalKeys } from "@/lib/query-keys";
import { usePortalCustomer } from "@/contexts/portal";
import {
  availabilityKey,
  useFinishedGoodAvailability,
} from "./use-finished-good-availability";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { EmptyStateHint } from "@/components/universal/empty-state-hint";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import Link from "next/link";

/** One line the customer is proposing, before it becomes an `order_items` row. */
type DraftLine = {
  brandId: string;
  brandName: string;
  sellingFormatId?: string;
  sellingFormatName?: string;
  quantity: number;
};

export function OrderBuilder() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const supabase = createClient();
  const { customers, customerIds } = usePortalCustomer();

  // A portal user can be linked to more than one customer; with exactly one
  // there is nothing to choose, so the selector is hidden rather than disabled.
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [requestedDate, setRequestedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [addingLine, setAddingLine] = useState(false);
  const [newLineKey, setNewLineKey] = useState("");
  const [newLineQty, setNewLineQty] = useState(1);

  const { availableGoods, isLoading, getAvailable } =
    useFinishedGoodAvailability();

  /** Goods not already on a line — the same rule the change request builder uses. */
  const addableGoods = useMemo(() => {
    if (!availableGoods) return [];
    const taken = new Set(
      lines.map((line) => availabilityKey(line.brandId, line.sellingFormatId))
    );
    return availableGoods.filter(
      (fg) =>
        !taken.has(
          availabilityKey(fg.brand_id, fg.selling_format_id ?? undefined)
        )
    );
  }, [availableGoods, lines]);

  const selectedGood = addableGoods.find(
    (fg) =>
      availabilityKey(fg.brand_id, fg.selling_format_id ?? undefined) ===
      newLineKey
  );

  function handleAddLine() {
    if (!selectedGood) return;
    const max = selectedGood.available_quantity;
    setLines((prev) => [
      ...prev,
      {
        brandId: selectedGood.brand_id,
        brandName: selectedGood.brands?.name ?? "Unknown",
        sellingFormatId: selectedGood.selling_format_id ?? undefined,
        sellingFormatName: selectedGood.selling_formats?.name ?? undefined,
        quantity: Math.min(Math.max(1, newLineQty), max),
      },
    ]);
    setAddingLine(false);
    setNewLineKey("");
    setNewLineQty(1);
  }

  function handleQuantityChange(index: number, value: number) {
    setLines((prev) => {
      const updated = [...prev];
      const line = { ...updated[index] };
      // `getAvailable` returns 0 for anything no longer in the availability
      // map — which happens for real: staff allocate the last of a product
      // while the customer has the page open, React Query refetches on focus,
      // and the pair drops out. Clamping to that 0 would silently set the line
      // to zero, and `quantity > 0` is in 00290's WITH CHECK, so submit would
      // fail *after* the parent order row was already inserted, stranding a
      // zero-line draft that had consumed an ORD- number.
      const max = Math.max(1, getAvailable(line.brandId, line.sellingFormatId));
      line.quantity = Math.min(Math.max(1, value), max);
      updated[index] = line;
      return updated;
    });
  }

  const mutation = useMutation({
    mutationFn: async () => {
      // Two statements, not one transaction: PostgREST autocommits each call,
      // and 00290 deliberately exposes plain INSERT policies rather than an
      // RPC. If the line insert fails the draft order survives with no items.
      // A customer cannot clean that up (there is no customer DELETE policy),
      // but staff see a zero-line draft, and a draft is never fulfillable, so
      // the failure is visible and inert rather than silent.
      // Sharper than "one stray draft": 00291 makes the order INSERT consume
      // the shared ORD- sequence, so each failed attempt burns a real order
      // number, and the customer's only recovery is pressing Submit again —
      // there is no resume-into-existing-draft path and no customer DELETE.
      // Repeated failures therefore leave N numbered empty drafts, so the
      // item-insert failure is surfaced explicitly below rather than as a raw
      // error toast that invites retrying.
      // tx-ok: the two inserts are not required to succeed together. A draft
      // with no line items is inert — never fulfillable, visible to staff, and
      // the customer is told explicitly that the order exists but is empty.
      // Making them atomic needs a SECURITY DEFINER RPC inserting order and
      // lines together (mirroring apply_change_request, 00264), which 00290
      // deliberately did not build; tracked as the upgrade path here.
      const order = (await unwrap(
        dynamicFrom(supabase, "orders")
          .insert({
            customer_id: customerId,
            // Pinned by the 00290 WITH CHECK, not merely by this UI.
            status: "draft",
            order_date: new Date().toISOString().slice(0, 10),
            ...(requestedDate ? { requested_date: requestedDate } : {}),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          })
          .select("id")
          .single()
      )) as unknown as { id: string };

      try {
        await unwrap(
          dynamicFrom(supabase, "order_items").insert(
            lines.map((line) => ({
              order_id: order.id,
              brand_id: line.brandId,
              selling_format_id: line.sellingFormatId ?? null,
              quantity: line.quantity,
              // unit_price omitted on purpose — 00290 requires it to be NULL.
            }))
          )
        );
      } catch (cause) {
        // The order row is already committed and cannot be removed from here.
        // Say so plainly instead of letting a generic failure toast imply
        // nothing happened — retrying would create a second numbered draft.
        throw new Error(
          "Your order was created but its items could not be added. Please contact your brewery rather than submitting again — resubmitting would create a second order.",
          { cause }
        );
      }

      return order.id;
    },
    onSuccess: (orderId) => {
      queryClient.invalidateQueries({
        queryKey: portalKeys.orders(customerIds),
      });
      toast.success("Order submitted — your brewery will confirm it shortly");
      router.push(`/portal/orders/${orderId}`);
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to submit the order"
      );
    },
  });

  const canSubmit = lines.length > 0 && !!customerId && !mutation.isPending;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/portal/orders"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Orders
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Place an Order</h1>
      </div>

      {customers.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger id="order-customer">
                <SelectValue placeholder="Select an account..." />
              </SelectTrigger>
              <SelectContent>
                {customers.map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {lines.length === 0 ? (
            <EmptyStateHint message="No items yet. Add a product to get started." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Format</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, index) => {
                  const max = getAvailable(line.brandId, line.sellingFormatId);
                  return (
                    <TableRow
                      key={availabilityKey(line.brandId, line.sellingFormatId)}
                    >
                      <TableCell className="font-medium">
                        {line.brandName}
                      </TableCell>
                      <TableCell>{line.sellingFormatName || "-"}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={1}
                          max={max}
                          value={line.quantity}
                          onChange={(e) =>
                            handleQuantityChange(
                              index,
                              parseInt(e.target.value) || 1
                            )
                          }
                          className="ml-auto w-24 text-right"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setLines((prev) =>
                              prev.filter((_, i) => i !== index)
                            )
                          }
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {addingLine ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <Label htmlFor="add-line-select">Product / Format</Label>
                  <Select value={newLineKey} onValueChange={setNewLineKey}>
                    <SelectTrigger id="add-line-select">
                      <SelectValue placeholder="Select a product..." />
                    </SelectTrigger>
                    <SelectContent>
                      {addableGoods.map((fg) => {
                        const key = availabilityKey(
                          fg.brand_id,
                          fg.selling_format_id ?? undefined
                        );
                        return (
                          <SelectItem key={key} value={key}>
                            {fg.brands?.name ?? "Unknown"} -{" "}
                            {fg.selling_formats?.name || "Unknown"} (
                            {fg.available_quantity} available)
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="add-line-qty">Quantity</Label>
                  <Input
                    id="add-line-qty"
                    type="number"
                    min={1}
                    max={selectedGood?.available_quantity ?? 1}
                    value={newLineQty}
                    onChange={(e) => setNewLineQty(parseInt(e.target.value) || 1)}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAddLine} disabled={!newLineKey}>
                  Add
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setAddingLine(false);
                    setNewLineKey("");
                    setNewLineQty(1);
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
              onClick={() => setAddingLine(true)}
              disabled={addableGoods.length === 0}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Item
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="requested-date">Requested delivery date</Label>
            <Input
              id="requested-date"
              type="date"
              value={requestedDate}
              onChange={(e) => setRequestedDate(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="order-notes">Notes</Label>
            <Textarea
              id="order-notes"
              placeholder="Anything your brewery should know about this order..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Your order is submitted as a draft. Your brewery confirms it and applies
        pricing before anything ships.
      </p>

      <div className="flex justify-end">
        <Button onClick={() => mutation.mutate()} disabled={!canSubmit}>
          {mutation.isPending ? "Submitting..." : "Submit Order"}
        </Button>
      </div>
    </div>
  );
}
