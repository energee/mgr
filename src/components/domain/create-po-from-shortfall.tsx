"use client";

/**
 * CreatePOFromShortfall - Create a draft PO to address an ingredient shortfall
 *
 * Pre-fills PO data based on the shortfall:
 * - Supplier selection (pre-selected preferred supplier)
 * - Quantity (respects min order quantity)
 * - Expected delivery date (based on lead time)
 */

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { supplierKeys, purchaseOrderKeys } from "@/lib/query-keys";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ShoppingCart, Calendar, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { IngredientShortfall } from "@/lib/purchasing/demand-calculator";
import { getCatalogTypeDisplay, formatQuantityWithUnit } from "@/lib/purchasing/demand-calculator";
import { generateNextPONumber } from "@/lib/purchasing/po-generator";

// =============================================================================
// Types
// =============================================================================

const createPOSchema = z.object({
  po_number: z.string().min(1, "PO number is required"),
  supplier_id: z.string().uuid("Please select a supplier"),
  quantity: z.coerce.number().positive("Quantity must be positive"),
  unit_price: z.coerce.number().min(0).optional(),
  expected_date: z.string().min(1, "Expected date is required"),
  notes: z.string().optional(),
});

type CreatePOFormValues = z.infer<typeof createPOSchema>;

interface CreatePOFromShortfallProps {
  shortfall: IngredientShortfall;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function CreatePOFromShortfall({
  shortfall,
  open,
  onOpenChange,
  onSuccess,
}: CreatePOFromShortfallProps) {
  const supabase = createClient();

  // Fetch suppliers
  const { data: suppliers, isLoading: suppliersLoading } = useQuery({
    queryKey: supplierKeys.active(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Generate next PO number
  const { data: nextPONumber } = useQuery({
    queryKey: purchaseOrderKeys.nextNumber(),
    queryFn: async () => generateNextPONumber(),
    enabled: open,
  });

  // Calculate expected date based on lead time
  const calculateExpectedDate = () => {
    const orderDate = new Date(shortfall.order_by_date);
    const expectedDate = new Date(orderDate);
    expectedDate.setDate(expectedDate.getDate() + shortfall.lead_time_days);
    return expectedDate.toISOString().split("T")[0];
  };

  // Calculate minimum quantity respecting MOQ
  const calculateMinQuantity = () => {
    return shortfall.min_order_qty
      ? Math.max(shortfall.shortfall_qty, shortfall.min_order_qty)
      : shortfall.shortfall_qty;
  };

  // Form setup
  const form = useForm<CreatePOFormValues>({
    resolver: zodResolver(createPOSchema),
    defaultValues: {
      po_number: "",
      supplier_id: shortfall.preferred_supplier_id || "",
      quantity: calculateMinQuantity(),
      unit_price: shortfall.unit_price || undefined,
      expected_date: calculateExpectedDate(),
      notes: `Created from ingredient demand - ${shortfall.catalog_name} shortfall`,
    },
  });

  // Update form when data loads
  useEffect(() => {
    if (nextPONumber) {
      form.setValue("po_number", nextPONumber);
    }
  }, [nextPONumber, form]);

  useEffect(() => {
    if (shortfall.preferred_supplier_id) {
      form.setValue("supplier_id", shortfall.preferred_supplier_id);
    }
  }, [shortfall.preferred_supplier_id, form]);

  // Create PO mutation
  const createMutation = useMutation({
    mutationFn: async (values: CreatePOFormValues) => {
      // Create the PO directly using supabase
      const { data: po, error: poError } = await supabase
        .from("purchase_orders")
        .insert({
          po_number: values.po_number,
          supplier_id: values.supplier_id,
          status: "draft",
          order_date: new Date().toISOString().split("T")[0],
          expected_date: values.expected_date,
          notes: values.notes,
        })
        .select()
        .single();

      if (poError) throw poError;

      // Create the line item
      const { error: lineError } = await supabase
        .from("po_line_items")
        .insert({
          po_id: po.id,
          catalog_type: shortfall.catalog_type,
          catalog_id: shortfall.catalog_id,
          quantity: values.quantity,
          unit: shortfall.unit,
          unit_price: values.unit_price,
        });

      if (lineError) {
        // Delete the PO if line item creation fails
        await supabase.from("purchase_orders").delete().eq("id", po.id);
        throw lineError;
      }

      return po;
    },
    onSuccess: (data) => {
      toast.success(`PO ${data.po_number} created`);
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      console.error("Create PO error:", error);
      const message = error instanceof Error ? error.message : "Failed to create PO";
      toast.error(message);
    },
  });

  const handleSubmit = form.handleSubmit((values) => {
    createMutation.mutate(values);
  });

  const quantity = form.watch("quantity");
  const unitPrice = form.watch("unit_price");
  const estimatedTotal = quantity && unitPrice ? quantity * unitPrice : null;

  // Check if order_by_date is past
  const isPastOrderDate = new Date(shortfall.order_by_date) < new Date();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Create Purchase Order
          </DialogTitle>
          <DialogDescription>
            Create a PO to address the shortfall for{" "}
            <span className="font-medium">{shortfall.catalog_name}</span>.
          </DialogDescription>
        </DialogHeader>

        {/* Shortfall Summary */}
        <div className="rounded-lg border p-3 bg-muted/50">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">Ingredient:</span>{" "}
              <span className="font-medium">{shortfall.catalog_name}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Type:</span>{" "}
              <span className="font-medium">{getCatalogTypeDisplay(shortfall.catalog_type)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Shortfall:</span>{" "}
              <span className="font-medium">{formatQuantityWithUnit(shortfall.shortfall_qty, shortfall.unit)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">For:</span>{" "}
              <span className="font-medium">{shortfall.batch_count} batch{shortfall.batch_count !== 1 ? "es" : ""}</span>
            </div>
            <div className="col-span-2 flex items-center gap-1">
              {isPastOrderDate && <AlertTriangle className="h-4 w-4 text-destructive" />}
              <span className="text-muted-foreground">Order By:</span>{" "}
              <span className={`font-medium ${isPastOrderDate ? "text-destructive" : ""}`}>
                {new Date(shortfall.order_by_date).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              {isPastOrderDate && <span className="text-xs text-destructive">(past due)</span>}
            </div>
            {shortfall.min_order_qty && shortfall.min_order_qty > shortfall.shortfall_qty && (
              <div className="col-span-2 text-xs text-amber-600">
                Note: Minimum order quantity ({shortfall.min_order_qty} {shortfall.unit}) exceeds shortfall
              </div>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="po_number">PO Number</Label>
              <Input
                id="po_number"
                {...form.register("po_number")}
                placeholder="e.g., PO-2025-001"
              />
              {form.formState.errors.po_number && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.po_number.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="expected_date">Expected Delivery</Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="expected_date"
                  type="date"
                  className="pl-9"
                  {...form.register("expected_date")}
                />
              </div>
              {form.formState.errors.expected_date && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.expected_date.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="supplier_id">Supplier</Label>
            <Select
              value={form.watch("supplier_id")}
              onValueChange={(v) => form.setValue("supplier_id", v)}
              disabled={suppliersLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={suppliersLoading ? "Loading..." : "Select supplier..."} />
              </SelectTrigger>
              <SelectContent>
                {suppliers?.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id}>
                    {supplier.name}
                    {supplier.id === shortfall.preferred_supplier_id && (
                      <span className="text-muted-foreground ml-2">(Preferred)</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.supplier_id && (
              <p className="text-sm text-destructive">
                {form.formState.errors.supplier_id.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity ({shortfall.unit})</Label>
              <Input
                id="quantity"
                type="number"
                step="0.01"
                {...form.register("quantity")}
                placeholder={`Min: ${shortfall.min_order_qty || shortfall.shortfall_qty}`}
              />
              {form.formState.errors.quantity && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.quantity.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="unit_price">Unit Price ($)</Label>
              <Input
                id="unit_price"
                type="number"
                step="0.01"
                {...form.register("unit_price")}
                placeholder="e.g., 2.50"
              />
              {form.formState.errors.unit_price && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.unit_price.message}
                </p>
              )}
            </div>
          </div>

          {estimatedTotal !== null && (
            <div className="text-sm text-muted-foreground">
              Estimated total: <span className="font-medium">${estimatedTotal.toFixed(2)}</span>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || !suppliers?.length}
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <ShoppingCart className="h-4 w-4 mr-2" />
                  Create PO
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
