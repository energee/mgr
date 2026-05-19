"use client";

/**
 * Order Items Editor
 *
 * Inline editor for order line items. Shows list of items with ability to
 * add, edit, and remove items. Calculates order totals.
 *
 * Features:
 * - Auto-pricing from customer's price tier when brand/format selected
 * - Shows price source (tier name badge when auto-priced)
 * - Manual price override support
 * - Uses unified selling_format_id (containers + selling_formats model)
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicRpc } from "@/services/types";
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
  Combobox,
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Plus, Trash2, Loader2, DollarSign, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { orderKeys, finishedGoodKeys } from "@/lib/query-keys";
import { useBrands, usePackagingFormats, useKegOwners, formatVolumeLabel } from "@/hooks/use-catalog";
import { useCalculateOrderMaterials } from "@/hooks/use-material-planning";
import { log } from "@/lib/client-logger";

// =============================================================================
// Types
// =============================================================================

type OrderItemRow = {
  id: string;
  brand_id: string | null;
  selling_format_id: string | null;
  keg_owner_id: string | null;
  quantity: number;
  unit_price: number | null;
  notes: string | null;
}

type OrderItemsEditorProps = {
  orderId: string;
  customerId?: string | null;
  readOnly?: boolean;
}

type NewItemState = {
  brand_id: string;
  format_id: string;
  keg_owner_id: string;
  quantity: number;
  unit_price: number;
  suggestedPrice: number | null;
  tierName: string | null;
}

type TierPriceResult = {
  price: number;
  tier_name: string;
  is_brand_specific: boolean;
  is_style_specific: boolean;
}

const EMPTY_NEW_ITEM: NewItemState = {
  brand_id: "",
  format_id: "",
  keg_owner_id: "",
  quantity: 1,
  unit_price: 0,
  suggestedPrice: null,
  tierName: null,
};

// =============================================================================
// Inventory Awareness Hooks
// =============================================================================

function useBrandAvailability() {
  const supabase = createClient();
  return useQuery({
    queryKey: finishedGoodKeys.brandAvailability(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finished_goods_with_availability")
        .select("brand_id, selling_format_id, available_quantity")
        .gt("available_quantity", 0);
      if (error) throw error;
      const byBrand: Record<string, number> = {};
      const byBrandFormat: Record<string, number> = {};
      for (const row of data ?? []) {
        if (row.brand_id) {
          byBrand[row.brand_id] = (byBrand[row.brand_id] ?? 0) + (row.available_quantity ?? 0);
        }
        if (row.brand_id && row.selling_format_id) {
          const key = `${row.brand_id}:${row.selling_format_id}`;
          byBrandFormat[key] = (byBrandFormat[key] ?? 0) + (row.available_quantity ?? 0);
        }
      }
      return { byBrand, byBrandFormat };
    },
  });
}

function useAvailability(brandId: string | null, sellingFormatId: string | null) {
  const supabase = createClient();
  return useQuery({
    queryKey: finishedGoodKeys.availability(brandId ?? "", sellingFormatId ?? ""),
    queryFn: async () => {
      if (!brandId || !sellingFormatId) return [];
      const { data, error } = await supabase
        .from("finished_goods_with_availability")
        .select("id, lot_number, production_date, quantity, available_quantity")
        .eq("brand_id", brandId)
        .eq("selling_format_id", sellingFormatId)
        .gt("available_quantity", 0)
        .order("production_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!brandId && !!sellingFormatId,
  });
}

// =============================================================================
// Availability Panel
// =============================================================================

function AvailabilityPanel({ brandId, sellingFormatId }: { brandId: string | null; sellingFormatId: string | null }) {
  const { data: fgItems, isLoading } = useAvailability(brandId, sellingFormatId);

  if (!brandId || !sellingFormatId) return null;
  if (isLoading) return <div className="text-sm text-muted-foreground p-2"><Loader2 className="h-3 w-3 animate-spin inline mr-1" />Checking inventory...</div>;
  if (!fgItems || fgItems.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-2 border rounded bg-muted/50">
        No inventory — will need production
      </div>
    );
  }

  const totalAvailable = fgItems.reduce((sum, fg) => sum + (fg.available_quantity ?? 0), 0);

  return (
    <div className="text-sm border rounded p-2 space-y-1 bg-muted/30">
      <div className="font-medium">{totalAvailable} available across {fgItems.length} lot{fgItems.length !== 1 ? "s" : ""}</div>
      {fgItems.map((fg) => (
        <div key={fg.id} className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{fg.lot_number} ({fg.production_date})</span>
          <span>{fg.available_quantity} avail</span>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export function OrderItemsEditor({ orderId, customerId, readOnly = false }: OrderItemsEditorProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  // New item form state
  const [newItem, setNewItem] = useState<NewItemState>({ ...EMPTY_NEW_ITEM });
  const [showAddRow, setShowAddRow] = useState(false);

  // Fetch order details including customer_id
  const { data: order } = useQuery({
    queryKey: orderKeys.detail(orderId),
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

  // Shipping material auto-calculation — triggered after line item changes
  const calculateMaterials = useCalculateOrderMaterials(
    orderId,
    effectiveCustomerId ?? ""
  );

  // Fetch order items
  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: orderKeys.items(orderId),
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

  // Function to look up tier price for a selling format (works for all format types including kegs)
  const lookupTierPrice = useCallback(async (
    brandId: string | null,
    formatId: string | null
  ): Promise<TierPriceResult | null> => {
    if (!effectiveCustomerId || !formatId) return null;

    try {
      const { data, error } = await dynamicRpc(supabase, "get_price_for_customer", {
        p_customer_id: effectiveCustomerId,
        p_format_id: formatId,
        p_brand_id: brandId || null,
        p_style_id: null,
      });

      if (error) {
        log.error("Price lookup error:", error);
        return null;
      }

      if (data && data.length > 0) {
        return data[0] as TierPriceResult;
      }
      return null;
    } catch (e) {
      log.error("Price lookup failed:", e);
      return null;
    }
  }, [effectiveCustomerId, supabase]);

  // Fetch catalog data (must be above useEffect that references them)
  const { data: brands } = useBrands();
  const { data: packagingFormats } = usePackagingFormats();
  const { data: kegOwners } = useKegOwners();

  // O(1) keg format check — must be above useEffect that references it
  const kegFormatIds = useMemo(() => {
    const set = new Set<string>();
    for (const f of packagingFormats ?? []) {
      if (f.container_type === "keg") set.add(f.id);
    }
    return set;
  }, [packagingFormats]);

  // Auto-lookup price when brand or format changes in new item (all formats including kegs)
  useEffect(() => {
    const lookupPrice = async () => {
      if (newItem.brand_id && newItem.format_id) {
        const result = await lookupTierPrice(newItem.brand_id, newItem.format_id);
        if (result) {
          setNewItem((prev) => ({
            ...prev,
            suggestedPrice: result.price,
            tierName: result.tier_name,
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
  }, [newItem.brand_id, newItem.format_id, lookupTierPrice]);

  // Inventory availability
  const { data: availability } = useBrandAvailability();

  const sortedBrands = useMemo(() => {
    if (!brands || !availability) return brands ?? [];
    return [...brands].sort((a, b) => {
      const aAvail = availability.byBrand[a.id] ?? 0;
      const bAvail = availability.byBrand[b.id] ?? 0;
      if (aAvail > 0 && bAvail === 0) return -1;
      if (aAvail === 0 && bAvail > 0) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [brands, availability]);

  // Availability for new item row
  const { data: newItemFGs } = useAvailability(
    newItem.brand_id || null,
    newItem.format_id || null,
  );
  const newItemTotalAvailable = newItemFGs?.reduce((sum, fg) => sum + (fg.available_quantity ?? 0), 0);

  // Add item mutation
  const addItem = useMutation({
    mutationFn: async (item: NewItemState) => {
      const isKeg = kegFormatIds.has(item.format_id ?? "");
      const { error } = await supabase.from("order_items").insert({
        order_id: orderId,
        brand_id: item.brand_id || null,
        selling_format_id: item.format_id || null,
        keg_owner_id: isKeg ? item.keg_owner_id || null : null,
        quantity: item.quantity,
        unit_price: item.unit_price || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderKeys.items(orderId) });
      setNewItem({ ...EMPTY_NEW_ITEM });
      setShowAddRow(false);
      toast.success("Item added");
      // Recalculate shipping materials now that line items changed
      if (effectiveCustomerId) calculateMaterials.mutate();
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

  // Update item mutation (single field)
  const updateItem = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: unknown }) => {
      const { error } = await supabase
        .from("order_items")
        .update({ [field]: value })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, { field }) => {
      queryClient.invalidateQueries({ queryKey: orderKeys.items(orderId) });
      // Recalculate when quantity or selling format changes (pallet count may change)
      if (effectiveCustomerId && (field === "quantity" || field === "selling_format_id")) {
        calculateMaterials.mutate();
      }
    },
    onError: () => {
      toast.error("Failed to update item");
    },
  });

  // Handle format change for existing items
  const handleFormatChange = async (itemId: string, formatId: string) => {
    const format = packagingFormats?.find((f) => f.id === formatId);
    if (!format) return;

    const updates: Record<string, unknown> = { selling_format_id: formatId };
    // Clear keg_owner_id when switching to non-keg format
    if (format.container_type !== "keg") {
      updates.keg_owner_id = null;
    }

    const { error } = await supabase
      .from("order_items")
      .update(updates)
      .eq("id", itemId);
    if (error) {
      toast.error("Failed to update format");
      return;
    }
    queryClient.invalidateQueries({ queryKey: orderKeys.items(orderId) });
    // Recalculate materials — new format may have different pallet config
    if (effectiveCustomerId) calculateMaterials.mutate();
  };

  // Delete item mutation
  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("order_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderKeys.items(orderId) });
      toast.success("Item removed");
      // Recalculate materials — fewer line items means fewer pallets
      if (effectiveCustomerId) calculateMaterials.mutate();
    },
    onError: () => {
      toast.error("Failed to remove item");
    },
  });

  // Calculate totals
  const total = items?.reduce((sum, item) => {
    return sum + (item.quantity * (item.unit_price || 0));
  }, 0) || 0;

  // Pre-compute lookup maps to avoid O(n) find per row per render
  const formatNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of packagingFormats ?? []) map.set(f.id, f.name);
    return map;
  }, [packagingFormats]);

  const kegOwnerNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of kegOwners ?? []) map.set(o.id, o.name);
    return map;
  }, [kegOwners]);

  const brandNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of brands ?? []) map.set(b.id, b.name);
    return map;
  }, [brands]);

  // Helper functions
  const getBrandName = (id: string | null) =>
    (id ? brandNameMap.get(id) : null) ?? "—";

  const getFormatName = (item: OrderItemRow) =>
    formatNameMap.get(item.selling_format_id ?? "") ?? "—";

  const getFormatId = (item: OrderItemRow) =>
    item.selling_format_id ?? "";

  const getKegOwnerName = (id: string | null) =>
    (id ? kegOwnerNameMap.get(id) : null) ?? null;

  // Handle add item
  const handleAdd = () => {
    if (!newItem.brand_id || !newItem.format_id) {
      toast.error("Please select a brand and format");
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
            <TableHead>Format</TableHead>
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
                  <Combobox
                    value={item.brand_id || ""}
                    onValueChange={(v) =>
                      updateItem.mutate({ id: item.id, field: "brand_id", value: v || null })
                    }
                    onFilter={(values, search) => {
                      const term = search.toLowerCase();
                      return values.filter((v) => brands?.find((b) => b.id === v)?.name.toLowerCase().includes(term));
                    }}
                  >
                    <ComboboxAnchor className="h-8">
                      <ComboboxInput className="h-8" placeholder="Select brand" />
                      <ComboboxTrigger />
                    </ComboboxAnchor>
                    <ComboboxContent>
                      <ComboboxEmpty>No brands found</ComboboxEmpty>
                      {sortedBrands.map((b) => (
                        <ComboboxItem key={b.id} value={b.id} label={b.name}>
                          <span className="flex items-center gap-2">
                            {b.name}
                            {availability?.byBrand[b.id]
                              ? <Badge variant="secondary" className="text-xs">{availability.byBrand[b.id]} avail</Badge>
                              : <span className="text-xs text-muted-foreground">no stock</span>
                            }
                          </span>
                        </ComboboxItem>
                      ))}
                    </ComboboxContent>
                  </Combobox>
                )}
              </TableCell>
              <TableCell>
                {readOnly ? (
                  <span className="flex items-center gap-1.5">
                    {getFormatName(item)}
                    {kegFormatIds.has(item.selling_format_id ?? "") && getKegOwnerName(item.keg_owner_id) && (
                      <Badge variant="outline" className="text-xs">{getKegOwnerName(item.keg_owner_id)}</Badge>
                    )}
                  </span>
                ) : (
                  <div className="space-y-1">
                    <Combobox
                      value={getFormatId(item)}
                      onValueChange={(v) => handleFormatChange(item.id, v)}
                      onFilter={(values, search) => {
                        const term = search.toLowerCase();
                        return values.filter((v) => packagingFormats?.find((f) => f.id === v)?.name.toLowerCase().includes(term));
                      }}
                    >
                      <ComboboxAnchor className="h-8">
                        <ComboboxInput className="h-8" placeholder="Select format" />
                        <ComboboxTrigger />
                      </ComboboxAnchor>
                      <ComboboxContent>
                        <ComboboxEmpty>No formats found</ComboboxEmpty>
                        {packagingFormats?.map((f) => (
                          <ComboboxItem key={f.id} value={f.id} label={f.name}>
                            <span className="flex items-center gap-2">
                              {f.name}
                              {formatVolumeLabel(f) != null && (
                                <span className="text-xs text-muted-foreground">{formatVolumeLabel(f)}</span>
                              )}
                              {f.container_type === "keg" && (
                                <Badge variant="outline" className="text-xs">keg</Badge>
                              )}
                              {item.brand_id && availability?.byBrandFormat[`${item.brand_id}:${f.id}`]
                                ? <Badge variant="secondary" className="text-xs">{availability.byBrandFormat[`${item.brand_id}:${f.id}`]} avail</Badge>
                                : item.brand_id ? <span className="text-xs text-muted-foreground">no stock</span> : null
                              }
                            </span>
                          </ComboboxItem>
                        ))}
                      </ComboboxContent>
                    </Combobox>
                    {kegFormatIds.has(item.selling_format_id ?? "") && (
                      <Combobox
                        value={item.keg_owner_id || ""}
                        onValueChange={(v) =>
                          updateItem.mutate({ id: item.id, field: "keg_owner_id", value: v || null })
                        }
                        onFilter={(values, search) => {
                          const term = search.toLowerCase();
                          return values.filter((v) => kegOwners?.find((o) => o.id === v)?.name.toLowerCase().includes(term));
                        }}
                      >
                        <ComboboxAnchor className="h-8">
                          <ComboboxInput className="h-8" placeholder="Keg owner (optional)" />
                          <ComboboxTrigger />
                        </ComboboxAnchor>
                        <ComboboxContent>
                          <ComboboxEmpty>No owners found</ComboboxEmpty>
                          {kegOwners?.map((o) => (
                            <ComboboxItem key={o.id} value={o.id} label={o.name}>
                              {o.name}
                            </ComboboxItem>
                          ))}
                        </ComboboxContent>
                      </Combobox>
                    )}
                  </div>
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
                    {effectiveCustomerId && item.brand_id && item.selling_format_id && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Apply tier price"
                              className="h-8 w-8 shrink-0"
                              onClick={() => applyTierPrice(item.id, item.brand_id, item.selling_format_id)}
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
                    aria-label="Remove item"
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
                <Combobox
                  value={newItem.brand_id}
                  onValueChange={(v) => setNewItem({ ...newItem, brand_id: v })}
                  onFilter={(values, search) => {
                    const term = search.toLowerCase();
                    return values.filter((v) => brands?.find((b) => b.id === v)?.name.toLowerCase().includes(term));
                  }}
                >
                  <ComboboxAnchor className="h-8">
                    <ComboboxInput className="h-8" placeholder="Select brand" />
                    <ComboboxTrigger />
                  </ComboboxAnchor>
                  <ComboboxContent>
                    <ComboboxEmpty>No brands found</ComboboxEmpty>
                    {sortedBrands.map((b) => (
                      <ComboboxItem key={b.id} value={b.id} label={b.name}>
                        <span className="flex items-center gap-2">
                          {b.name}
                          {availability?.byBrand[b.id]
                            ? <Badge variant="secondary" className="text-xs">{availability.byBrand[b.id]} avail</Badge>
                            : <span className="text-xs text-muted-foreground">no stock</span>
                          }
                        </span>
                      </ComboboxItem>
                    ))}
                  </ComboboxContent>
                </Combobox>
              </TableCell>
              <TableCell>
                <div className="space-y-1">
                  <Combobox
                    value={newItem.format_id}
                    onValueChange={(v) => {
                      const format = packagingFormats?.find((f) => f.id === v);
                      setNewItem({
                        ...newItem,
                        format_id: v,
                        // Clear keg_owner when switching to non-keg
                        keg_owner_id: format?.container_type === "keg" ? newItem.keg_owner_id : "",
                      });
                    }}
                    onFilter={(values, search) => {
                      const term = search.toLowerCase();
                      return values.filter((v) => packagingFormats?.find((f) => f.id === v)?.name.toLowerCase().includes(term));
                    }}
                  >
                    <ComboboxAnchor className="h-8">
                      <ComboboxInput className="h-8" placeholder="Select format" />
                      <ComboboxTrigger />
                    </ComboboxAnchor>
                    <ComboboxContent>
                      <ComboboxEmpty>No formats found</ComboboxEmpty>
                      {packagingFormats?.map((f) => (
                        <ComboboxItem key={f.id} value={f.id} label={f.name}>
                          <span className="flex items-center gap-2">
                            {f.name}
                            {formatVolumeLabel(f) != null && (
                              <span className="text-xs text-muted-foreground">{formatVolumeLabel(f)}</span>
                            )}
                            {f.container_type === "keg" && (
                              <Badge variant="outline" className="text-xs">keg</Badge>
                            )}
                            {newItem.brand_id && availability?.byBrandFormat[`${newItem.brand_id}:${f.id}`]
                              ? <Badge variant="secondary" className="text-xs">{availability.byBrandFormat[`${newItem.brand_id}:${f.id}`]} avail</Badge>
                              : newItem.brand_id ? <span className="text-xs text-muted-foreground">no stock</span> : null
                            }
                          </span>
                        </ComboboxItem>
                      ))}
                    </ComboboxContent>
                  </Combobox>
                  {kegFormatIds.has(newItem.format_id) && (
                    <Combobox
                      value={newItem.keg_owner_id}
                      onValueChange={(v) => setNewItem({ ...newItem, keg_owner_id: v })}
                      onFilter={(values, search) => {
                        const term = search.toLowerCase();
                        return values.filter((v) => kegOwners?.find((o) => o.id === v)?.name.toLowerCase().includes(term));
                      }}
                    >
                      <ComboboxAnchor className="h-8">
                        <ComboboxInput className="h-8" placeholder="Keg owner (optional)" />
                        <ComboboxTrigger />
                      </ComboboxAnchor>
                      <ComboboxContent>
                        <ComboboxEmpty>No owners found</ComboboxEmpty>
                        {kegOwners?.map((o) => (
                          <ComboboxItem key={o.id} value={o.id} label={o.name}>
                            {o.name}
                          </ComboboxItem>
                        ))}
                      </ComboboxContent>
                    </Combobox>
                  )}
                </div>
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
                {!kegFormatIds.has(newItem.format_id) && newItemTotalAvailable !== undefined && newItem.quantity > newItemTotalAvailable && (
                  <div className="text-xs text-orange-500 mt-1">
                    Exceeds available ({newItemTotalAvailable}). Will need production.
                  </div>
                )}
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
                              aria-label={`Use tier price: $${newItem.suggestedPrice?.toFixed(2)}`}
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
                    aria-label="Add item"
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

          {showAddRow && newItem.brand_id && newItem.format_id && !kegFormatIds.has(newItem.format_id) && (
            <TableRow>
              <TableCell colSpan={readOnly ? 5 : 6}>
                <AvailabilityPanel brandId={newItem.brand_id} sellingFormatId={newItem.format_id} />
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
