"use client";

/**
 * POReceiveDialog — Records a partial or full receipt against a PO line item.
 *
 * Writes a `po_receives` row with the received quantity, lot number, dates,
 * and notes. Inventory lots are created downstream by the accept-inventory
 * flow (see `po-accept-inventory-dialog.tsx`).
 *
 * Bundles helper: when the supplier ships in bundles (e.g., 10 stacks × 250
 * trays), checking "Received in bundles" reveals an inline multiplier that
 * auto-fills the Quantity field with the single-unit total. The bundle size
 * is not persisted — only the resulting quantity is stored on `po_receives`.
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/form-resolver";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { poReceiveSchema, type POReceiveFormValues } from "@/entities/po-receive";
import { entityKeys } from "@/lib/query-keys";
import { parsePositiveNumber } from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Package } from "lucide-react";

type POReceiveDialogProps = {
  poLineItemId: string;
  itemDescription: string;
  outstandingQty: number;
  unit: string;
  onSuccess?: () => void;
}

export function POReceiveDialog({
  poLineItemId,
  itemDescription,
  outstandingQty,
  unit,
  onSuccess,
}: POReceiveDialogProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const supabase = createClient();

  // Bundle-entry helper: lets the user type "10 stacks × 250 per stack" and
  // have the Quantity field auto-fill with 2,500. Pack size is not persisted —
  // only the computed single-unit quantity goes to `po_receives`.
  const [bundlesMode, setBundlesMode] = useState(false);
  const [bundles, setBundles] = useState("");
  const [perBundle, setPerBundle] = useState("");

  const form = useForm<POReceiveFormValues>({
    resolver: zodResolver(poReceiveSchema),
    defaultValues: {
      po_line_item_id: poLineItemId,
      quantity: outstandingQty,
      lot_number: "",
      received_date: new Date().toISOString().split("T")[0],
      expiration_date: "",
      notes: "",
    },
  });

  function syncBundleQuantity(b: string, p: string) {
    const bn = parsePositiveNumber(b);
    const pn = parsePositiveNumber(p);
    if (bn !== null && pn !== null) {
      form.setValue("quantity", bn * pn, { shouldValidate: true });
    }
  }

  const bundleTotal =
    bundlesMode && parsePositiveNumber(bundles) !== null && parsePositiveNumber(perBundle) !== null
      ? parsePositiveNumber(bundles)! * parsePositiveNumber(perBundle)!
      : null;

  const mutation = useMutation({
    mutationFn: async (values: POReceiveFormValues) => {
      const { error } = await supabase.from("po_receives").insert(values);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Receipt recorded");
      queryClient.invalidateQueries({ queryKey: entityKeys.all("purchase_order") });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("po_line_item") });
      setOpen(false);
      form.reset();
      onSuccess?.();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Package className="h-4 w-4 mr-2" />
          Receive
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Receive: {itemDescription}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="bundles-mode"
                  checked={bundlesMode}
                  onCheckedChange={(c) => {
                    const on = !!c;
                    setBundlesMode(on);
                    if (on) syncBundleQuantity(bundles, perBundle);
                  }}
                />
                <Label htmlFor="bundles-mode" className="text-sm font-normal">
                  Received in bundles
                </Label>
              </div>
              {bundlesMode && (
                <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    placeholder="Bundles"
                    value={bundles}
                    onChange={(e) => {
                      setBundles(e.target.value);
                      syncBundleQuantity(e.target.value, perBundle);
                    }}
                    className="w-24"
                    aria-label="Number of bundles"
                  />
                  <span className="text-sm text-muted-foreground">×</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    placeholder="Per bundle"
                    value={perBundle}
                    onChange={(e) => {
                      setPerBundle(e.target.value);
                      syncBundleQuantity(bundles, e.target.value);
                    }}
                    className="w-24"
                    aria-label="Units per bundle"
                  />
                  <span className="ml-auto text-sm tabular-nums">
                    = {bundleTotal !== null ? bundleTotal.toLocaleString() : "—"} {unit}
                  </span>
                </div>
              )}
            </div>
            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantity ({unit})</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      {...field}
                      readOnly={bundlesMode}
                      className={bundlesMode ? "bg-muted" : undefined}
                    />
                  </FormControl>
                  <FormMessage />
                  <p className="text-xs text-muted-foreground">
                    Outstanding: {outstandingQty} {unit}
                  </p>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="lot_number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Lot Number</FormLabel>
                  <FormControl>
                    <Input placeholder="Supplier lot #" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="received_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Received Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="expiration_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Expiration Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Quality notes, discrepancies..."
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Recording..." : "Record Receipt"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
