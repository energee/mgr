"use client";

/**
 * Order Items Editor
 *
 * Inline editor for order line items. Shows list of items with ability to
 * add, edit, and remove items. Calculates order totals.
 *
 * Features:
 * - Auto-pricing from customer's price tier when brand/format selected
 * - Shows price source (tier name or "manual")
 * - Manual price override with indication
 */

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Plus, Trash2, Loader2, DollarSign, RefreshCw } from "lucide-react";
import { toast } from "sonner";

// =============================================================================
// Types
// =============================================================================

interface OrderItemRow {
  id: string;
  brand_id: string | null;
  package_type_id: string | null;
  quantity: number;
  unit_price: number | null;
  notes: string | null;
}

interface OrderItemsEditorProps {
  orderId: string;
  customerId?: string | null;
  readOnly?: boolean;
}

interface NewItemState {
  brand_id: string;
  package_type_id: string;
  quantity: number;
  unit_price: number;
  suggestedPrice: number | null;
  tierName: string | null;
}

interface TierPriceResult {
  price: number;
  tier_name: string;
  is_brand_specific: boolean;
  is_style_specific: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function OrderItemsEditor({ orderId, customerId, readOnly = false }: OrderItemsEditorProps) {
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const queryClient = useQueryClient();

  // New item form state
  const [newItem, setNewItem] = useState<NewItemState>({
    brand_id: "",
    package_type_id: "",
    quantity: 1,
    unit_price: 0,
    suggestedPrice: null,
    tierName: null,
  });
  const [showAddRow, setShowAddRow] = useState(false);

  // Fetch order details including customer_id
  const { data: order } = useQuery({
    queryKey: ["order", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, customer_id")
        .eq("id", orderId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Use passed customerId or fetch from order
  const effectiveCustomerId = customerId ?? order?.customer_id;

  // Fetch order items
  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ["order-items", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_items")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as OrderItemRow[];
    },
  });

  // Function to look up tier price
  const lookupTierPrice = useCallback(async (
    brandId: string | null,
    formatId: string | null
  ): Promise<TierPriceResult | null> => {
    if (!effectiveCustomerId || !formatId) return null;

    try {
      const { data, error } = await db.rpc("get_price_for_customer", {
        p_customer_id: effectiveCustomerId,
        p_format_id: formatId,
        p_brand_id: brandId || null,
        p_style_id: null, // Could be enhanced to pass style_id from brand
      });

      if (error) {
        console.error("Price lookup error:", error);
        return null;
      }

      if (data && data.length > 0) {
        return data[0] as TierPriceResult;
      }
      return null;
    } catch (e) {
      console.error("Price lookup failed:", e);
      return null;
    }
  }, [effectiveCustomerId, db]);

  // Auto-lookup price when brand or format changes in new item
  useEffect(() => {
    const lookupPrice = async () => {
      if (newItem.brand_id && newItem.package_type_id) {
        const result = await lookupTierPrice(newItem.brand_id, newItem.package_type_id);
        if (result) {
          setNewItem((prev) => ({
            ...prev,
            suggestedPrice: result.price,
            tierName: result.tier_name,
            // Auto-fill price if not manually set
            unit_price: prev.unit_price === 0 ? result.price : prev.unit_price,
          }));
        } else {
          setNewItem((prev) => ({
            ...prev,
            suggestedPrice: null,
            tierName: null,
          }));
        }
      }
    };
    lookupPrice();
  }, [newItem.brand_id, newItem.package_type_id, lookupTierPrice]);

  // Fetch brands for dropdown
  const { data: brands } = useQuery({
    queryKey: ["brands"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch package types for dropdown
  const { data: packageTypes } = useQuery({
    queryKey: ["package-types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("package_types")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Add item mutation
  const addItem = useMutation({
    mutationFn: async (item: NewItemState) => {
      const { error } = await supabase.from("order_items").insert({
        order_id: orderId,
        brand_id: item.brand_id || null,
        package_type_id: item.package_type_id || null,
        quantity: item.quantity,
        unit_price: item.unit_price || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order-items", orderId] });
      setNewItem({
        brand_id: "",
        package_type_id: "",
        quantity: 1,
        unit_price: 0,
        suggestedPrice: null,
        tierName: null,
      });
      setShowAddRow(false);
      toast.success("Item added");
    },
    onError: () => {
      toast.error("Failed to add item");
    },
  });

  // Apply suggested price to an existing item
  const applyTierPrice = async (itemId: string, brandId: string | null, formatId: string | null) => {
    const result = await lookupTierPrice(brandId, formatId);
    if (result) {
      updateItem.mutate({
        id: itemId,
        field: "unit_price",
        value: result.price,
      });
      toast.success(`Applied ${result.tier_name} price: $${result.price.toFixed(2)}`);
    } else {
      toast.error("No tier price found for this combination");
    }
  };

  // Update item mutation
  const updateItem = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: unknown }) => {
      const { error } = await supabase
        .from("order_items")
        .update({ [field]: value })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order-items", orderId] });
    },
    onError: () => {
      toast.error("Failed to update item");
    },
  });

  // Delete item mutation
  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("order_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order-items", orderId] });
      toast.success("Item removed");
    },
    onError: () => {
      toast.error("Failed to remove item");
    },
  });

  // Calculate totals
  const total = items?.reduce((sum, item) => {
    return sum + (item.quantity * (item.unit_price || 0));
  }, 0) || 0;

  // Helper functions
  const getBrandName = (id: string | null) =>
    brands?.find((b) => b.id === id)?.name || "—";
  const getPackageName = (id: string | null) =>
    packageTypes?.find((p) => p.id === id)?.name || "—";

  // Handle add item
  const handleAdd = () => {
    if (!newItem.brand_id && !newItem.package_type_id) {
      toast.error("Please select a brand or package type");
      return;
    }
    if (newItem.quantity < 1) {
      toast.error("Quantity must be at least 1");
      return;
    }
    addItem.mutate(newItem);
  };

  if (itemsLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Line Items</h3>
        {!readOnly && !showAddRow && (
          <Button size="sm" variant="outline" onClick={() => setShowAddRow(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Item
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Brand</TableHead>
            <TableHead>Package</TableHead>
            <TableHead className="w-[100px]">Qty</TableHead>
            <TableHead className="w-[150px]">Unit Price</TableHead>
            <TableHead className="w-[100px] text-right">Line Total</TableHead>
            {!readOnly && <TableHead className="w-[60px]" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items?.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                {readOnly ? (
                  getBrandName(item.brand_id)
                ) : (
                  <Select
                    value={item.brand_id || ""}
                    onValueChange={(value) =>
                      updateItem.mutate({ id: item.id, field: "brand_id", value: value || null })
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="Select brand" />
                    </SelectTrigger>
                    <SelectContent>
                      {brands?.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </TableCell>
              <TableCell>
                {readOnly ? (
                  getPackageName(item.package_type_id)
                ) : (
                  <Select
                    value={item.package_type_id || ""}
                    onValueChange={(value) =>
                      updateItem.mutate({ id: item.id, field: "package_type_id", value: value || null })
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="Select package" />
                    </SelectTrigger>
                    <SelectContent>
                      {packageTypes?.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </TableCell>
              <TableCell>
                {readOnly ? (
                  item.quantity
                ) : (
                  <Input
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={(e) =>
                      updateItem.mutate({
                        id: item.id,
                        field: "quantity",
                        value: parseInt(e.target.value) || 1,
                      })
                    }
                    className="h-8 w-full"
                  />
                )}
              </TableCell>
              <TableCell>
                {readOnly ? (
                  item.unit_price ? `$${item.unit_price.toFixed(2)}` : "—"
                ) : (
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      value={item.unit_price || ""}
                      onChange={(e) =>
                        updateItem.mutate({
                          id: item.id,
                          field: "unit_price",
                          value: parseFloat(e.target.value) || null,
                        })
                      }
                      className="h-8 w-full"
                      placeholder="0.00"
                    />
                    {effectiveCustomerId && item.brand_id && item.package_type_id && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0"
                              onClick={() => applyTierPrice(item.id, item.brand_id, item.package_type_id)}
                            >
                              <RefreshCw className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Apply tier price</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-right font-medium">
                ${((item.quantity || 0) * (item.unit_price || 0)).toFixed(2)}
              </TableCell>
              {!readOnly && (
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => deleteItem.mutate(item.id)}
                    disabled={deleteItem.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}

          {/* Add new item row */}
          {showAddRow && (
            <TableRow>
              <TableCell>
                <Select
                  value={newItem.brand_id}
                  onValueChange={(value) => setNewItem({ ...newItem, brand_id: value })}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Select brand" />
                  </SelectTrigger>
                  <SelectContent>
                    {brands?.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Select
                  value={newItem.package_type_id}
                  onValueChange={(value) => setNewItem({ ...newItem, package_type_id: value })}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Select package" />
                  </SelectTrigger>
                  <SelectContent>
                    {packageTypes?.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  min={1}
                  value={newItem.quantity}
                  onChange={(e) =>
                    setNewItem({ ...newItem, quantity: parseInt(e.target.value) || 1 })
                  }
                  className="h-8 w-full"
                />
              </TableCell>
              <TableCell>
                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      value={newItem.unit_price || ""}
                      onChange={(e) =>
                        setNewItem({ ...newItem, unit_price: parseFloat(e.target.value) || 0 })
                      }
                      className="h-8 w-full"
                      placeholder="0.00"
                    />
                    {newItem.suggestedPrice !== null && newItem.unit_price !== newItem.suggestedPrice && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0"
                              onClick={() => setNewItem({ ...newItem, unit_price: newItem.suggestedPrice || 0 })}
                            >
                              <DollarSign className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Use tier price: ${newItem.suggestedPrice?.toFixed(2)}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                  {newItem.tierName && (
                    <Badge variant="outline" className="text-xs">
                      {newItem.tierName}
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right font-medium">
                ${(newItem.quantity * newItem.unit_price).toFixed(2)}
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button
                    size="icon"
                    className="h-8 w-8"
                    onClick={handleAdd}
                    disabled={addItem.isPending}
                  >
                    {addItem.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          )}

          {/* Empty state */}
          {(!items || items.length === 0) && !showAddRow && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                No line items yet. Click &quot;Add Item&quot; to add products to this order.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {items && items.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4} className="text-right font-medium">
                Order Total
              </TableCell>
              <TableCell className="text-right font-bold text-lg">
                ${total.toFixed(2)}
              </TableCell>
              {!readOnly && <TableCell />}
            </TableRow>
          </TableFooter>
        )}
      </Table>

      {showAddRow && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setShowAddRow(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
