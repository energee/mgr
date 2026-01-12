"use client";

/**
 * OrderForm - Custom Order Form with Line Items
 *
 * A custom form for orders that includes both order details and line items.
 * Handles creating/updating orders with their associated line items.
 */

import { useState, useMemo, type FormEvent, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { orderEntity, orderSchema } from "@/entities/order";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { OrderItemsEditor, type OrderItem } from "./order-items-editor";
import type { Database } from "@/types/supabase";

type Order = Database["public"]["Tables"]["orders"]["Row"];

interface OrderFormProps {
  /** Order ID (undefined for create mode) */
  id?: string;
}

export function OrderForm({ id }: OrderFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const supabase = createClient();
  const isEdit = Boolean(id);

  // Form state for order fields
  const [orderData, setOrderData] = useState({
    order_number: "",
    customer_id: null as string | null,
    status: "draft",
    order_date: new Date().toISOString().slice(0, 10),
    requested_date: null as string | null,
    scheduled_date: null as string | null,
    notes: null as string | null,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // State for order line items
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);

  // Fetch customers for select
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch existing order data for edit mode
  const { data: existingOrder, isLoading: loadingOrder } = useQuery({
    queryKey: ["orders", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as Order;
    },
    enabled: isEdit,
  });

  // Fetch existing order items for edit mode
  // Note: brand_id is added in migration 00018 - types may not include it yet
  const { data: existingItems = [], isLoading: loadingItems } = useQuery({
    queryKey: ["order-items", id],
    queryFn: async () => {
      if (!id) return [];
      // Use type assertion since brand_id may not be in generated types yet
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (query: string) => {
            eq: (field: string, value: string) => Promise<{ data: unknown[]; error: Error | null }>;
          };
        };
      })
        .from("order_items")
        .select(`
          *,
          brand:brands(id, name, abv),
          package_type:package_types(id, name, container_type, volume_oz)
        `)
        .eq("order_id", id);
      if (error) throw error;
      const items = data as Record<string, unknown>[] || [];
      return items.map((item) => ({
        id: item.id as string,
        brand_id: (item.brand_id as string) || null,
        package_type_id: (item.package_type_id as string) || null,
        quantity: item.quantity as number,
        unit_price: item.unit_price as number | null,
        notes: item.notes as string | null,
        brand: item.brand as OrderItem["brand"],
        package_type: item.package_type as OrderItem["package_type"],
      }));
    },
    enabled: isEdit,
  });

  // Load existing data into form state
  useEffect(() => {
    if (existingOrder) {
      setOrderData({
        order_number: existingOrder.order_number,
        customer_id: existingOrder.customer_id,
        status: existingOrder.status,
        order_date: existingOrder.order_date,
        requested_date: existingOrder.requested_date,
        scheduled_date: existingOrder.scheduled_date,
        notes: existingOrder.notes,
      });
    }
  }, [existingOrder]);

  useEffect(() => {
    if (existingItems.length > 0) {
      setOrderItems(existingItems);
    }
  }, [existingItems]);

  // Handle form field changes
  const handleChange = (field: string, value: unknown) => {
    setOrderData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  // Save order and items
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});

    // Validate order data
    const result = orderSchema.safeParse(orderData);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        const path = err.path.join(".");
        fieldErrors[path] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    // Validate line items
    const invalidItems = orderItems.filter(
      (item) => !item.brand_id || !item.package_type_id || !item.quantity
    );
    if (invalidItems.length > 0) {
      toast.error("Please complete all line items before saving.");
      return;
    }

    setIsSubmitting(true);
    try {
      let orderId = id;

      if (isEdit && id) {
        // Update existing order
        const { error } = await supabase
          .from("orders")
          .update(result.data)
          .eq("id", id);
        if (error) throw error;
      } else {
        // Create new order
        const { data, error } = await supabase
          .from("orders")
          .insert(result.data)
          .select("id")
          .single();
        if (error) throw error;
        orderId = data.id;
      }

      // Sync order items
      if (orderId) {
        // Delete existing items not in the new list
        if (isEdit) {
          const existingIds = existingItems.map((item) => item.id).filter((id): id is string => Boolean(id));
          const newIds = orderItems.map((item) => item.id).filter((id): id is string => Boolean(id));
          const toDelete = existingIds.filter((existId) => !newIds.includes(existId));

          if (toDelete.length > 0) {
            const { error } = await supabase
              .from("order_items")
              .delete()
              .in("id", toDelete);
            if (error) throw error;
          }
        }

        // Upsert order items
        // Note: brand_id is added in migration 00018 - using type assertion
        for (const item of orderItems) {
          const itemData = {
            brand_id: item.brand_id,
            package_type_id: item.package_type_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            notes: item.notes,
          };

          if (item.id) {
            // Update existing item
            const { error } = await supabase
              .from("order_items")
              .update(itemData as never)
              .eq("id", item.id)
              .eq("order_id", orderId);
            if (error) throw error;
          } else {
            // Insert new item
            const { error } = await supabase.from("order_items").insert({
              order_id: orderId,
              ...itemData,
            } as never);
            if (error) throw error;
          }
        }
      }

      toast.success(`Order ${isEdit ? "updated" : "created"} successfully`);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["orders", orderId] });
      queryClient.invalidateQueries({ queryKey: ["order-items", orderId] });
      router.push(`/sales/orders/${orderId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLoading = loadingOrder || loadingItems;

  // Status options from entity config
  const statusOptions = orderEntity.stateMachine
    ? orderEntity.stateMachine.states.map((state) => ({
        value: state,
        label: orderEntity.stateMachine?.stateDisplay?.[state]?.label || state,
      }))
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/sales/orders">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">
          {isEdit ? "Edit Order" : "New Order"}
        </h1>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-6">
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </CardContent>
        </Card>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Order Details */}
          <Card>
            <CardHeader>
              <CardTitle>Order Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-12 gap-4">
                {/* Order Number */}
                <div className="col-span-6 space-y-2">
                  <Label htmlFor="order_number">Order Number *</Label>
                  <Input
                    id="order_number"
                    value={orderData.order_number}
                    onChange={(e) => handleChange("order_number", e.target.value)}
                    placeholder="e.g., ORD-2025-001"
                  />
                  {errors.order_number && (
                    <p className="text-sm text-destructive">{errors.order_number}</p>
                  )}
                </div>

                {/* Status */}
                <div className="col-span-6 space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select
                    value={orderData.status}
                    onValueChange={(value) => handleChange("status", value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Customer */}
                <div className="col-span-12 space-y-2">
                  <Label htmlFor="customer_id">Customer</Label>
                  <Select
                    value={orderData.customer_id || ""}
                    onValueChange={(value) =>
                      handleChange("customer_id", value || null)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select customer..." />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((customer) => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Order Date */}
                <div className="col-span-4 space-y-2">
                  <Label htmlFor="order_date">Order Date *</Label>
                  <Input
                    id="order_date"
                    type="date"
                    value={orderData.order_date}
                    onChange={(e) => handleChange("order_date", e.target.value)}
                  />
                  {errors.order_date && (
                    <p className="text-sm text-destructive">{errors.order_date}</p>
                  )}
                </div>

                {/* Requested Date */}
                <div className="col-span-4 space-y-2">
                  <Label htmlFor="requested_date">Requested Delivery</Label>
                  <Input
                    id="requested_date"
                    type="date"
                    value={orderData.requested_date || ""}
                    onChange={(e) =>
                      handleChange("requested_date", e.target.value || null)
                    }
                  />
                </div>

                {/* Scheduled Date */}
                <div className="col-span-4 space-y-2">
                  <Label htmlFor="scheduled_date">Scheduled Delivery</Label>
                  <Input
                    id="scheduled_date"
                    type="date"
                    value={orderData.scheduled_date || ""}
                    onChange={(e) =>
                      handleChange("scheduled_date", e.target.value || null)
                    }
                  />
                </div>

                {/* Notes */}
                <div className="col-span-12 space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    value={orderData.notes || ""}
                    onChange={(e) => handleChange("notes", e.target.value || null)}
                    placeholder="Special instructions, delivery notes..."
                    rows={3}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card>
            <CardHeader>
              <CardTitle>Products</CardTitle>
            </CardHeader>
            <CardContent>
              <OrderItemsEditor
                items={orderItems}
                onChange={setOrderItems}
                disabled={isSubmitting}
              />
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Link href="/sales/orders">
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? "Save Changes" : "Create Order"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
