"use client";

/**
 * OrderAllocation - Allocate finished goods to an order
 *
 * Features:
 * - Lot list filtered to the brand+format combos on the order's line items
 *   (falls back to all lots when the order has no resolvable lines)
 * - Per-line demand summary: ordered / already allocated / remaining,
 *   counting existing planned+completed allocations (incl. pick-list ones)
 * - "Auto-allocate (FIFO)" pre-fills quantities oldest-first up to each
 *   line's remaining quantity (same rules as the generate_pick_list RPC,
 *   see order-allocation-utils.ts); inputs stay editable
 * - Quantity input validated against available
 * - Creates allocation records on save (skips lots already allocated here)
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { unwrap } from "@/lib/supabase/query-helpers";
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
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Package, Check, AlertCircle, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { orderKeys, inventoryKeys } from "@/lib/query-keys";
import { dynamicFrom } from "@/services/types";
import { useBrands, usePackagingFormats } from "@/hooks/use-catalog";
import { log } from "@/lib/client-logger";
import {
  comboKey,
  computeDemandLines,
  computeFifoFill,
} from "@/components/domain/order/order-allocation-utils";

// =============================================================================
// Types
// =============================================================================

type FinishedGoodAvailable = {
  id: string;
  lot_number: string;
  brand_id: string;
  selling_format_id: string;
  quantity: number;
  available_quantity: number;
  production_date: string | null;
}

type AllocationEntry = {
  finished_good_id: string;
  quantity: number;
}

/** Subset of order_items columns the dialog needs for demand math. */
type OrderItemLine = {
  id: string;
  brand_id: string | null;
  selling_format_id: string | null;
  quantity: number | null;
}

/** Existing planned/completed allocation joined with its lot's brand/format. */
type ExistingAllocation = {
  source_id: string | null;
  quantity: number | null;
  brand_id: string | null;
  selling_format_id: string | null;
}

type OrderAllocationProps = {
  orderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function OrderAllocation({
  orderId,
  open,
  onOpenChange,
  onSuccess,
}: OrderAllocationProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [allocations, setAllocations] = useState<Record<string, number>>({});

  // Fetch the order's line items — they define what this order actually needs.
  // select("*") keeps the cache shape identical to order-items-editor.tsx,
  // which shares this query key.
  const { data: orderItems, isLoading: itemsLoading } = useQuery({
    queryKey: orderKeys.items(orderId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_items")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as OrderItemLine[];
    },
    enabled: open,
  });

  // Fetch existing planned/completed allocations for this order with each
  // lot's brand/format, so per-line remaining can be computed. Pick-list
  // allocations (pick_list_item_id set) are plain rows here and count too.
  const { data: existingAllocations, isLoading: allocLoading } = useQuery({
    queryKey: orderKeys.allocatedLots(orderId),
    queryFn: async (): Promise<ExistingAllocation[]> => {
      const { data: allocs, error } = await supabase
        .from("allocations")
        .select("source_id, quantity")
        .eq("destination_type", "order")
        .eq("destination_id", orderId)
        .eq("source_type", "finished_good")
        .in("status", ["planned", "completed"]);
      if (error) throw error;
      if (!allocs || allocs.length === 0) return [];

      const fgIds = [
        ...new Set(allocs.map((a) => a.source_id).filter((v): v is string => !!v)),
      ];
      const { data: fgs, error: fgError } = await supabase
        .from("finished_goods")
        .select("id, brand_id, selling_format_id")
        .in("id", fgIds);
      if (fgError) throw fgError;

      const fgMap = new Map((fgs ?? []).map((fg) => [fg.id, fg]));
      return allocs.map((a) => {
        const fg = a.source_id ? fgMap.get(a.source_id) : undefined;
        return {
          source_id: a.source_id,
          quantity: a.quantity,
          brand_id: fg?.brand_id ?? null,
          selling_format_id: fg?.selling_format_id ?? null,
        };
      });
    },
    enabled: open,
  });

  // Fetch available finished goods (sorted by production date - FIFO)
  const { data: finishedGoods, isLoading: fgLoading } = useQuery({
    queryKey: inventoryKeys.finishedGoodsAvailable(),
    queryFn: async () => {
      return await unwrap(dynamicFrom(supabase, "finished_goods_with_availability")
        .select("id, lot_number, brand_id, selling_format_id, quantity, available_quantity, production_date")
        .gt("available_quantity", 0)
        .order("production_date", { ascending: true })) as unknown as FinishedGoodAvailable[];
    },
    enabled: open,
  });

  // Fetch brands and packaging formats for display
  const { data: brands } = useBrands();
  const { data: packagingFormats } = usePackagingFormats();

  // Create allocations mutation with duplicate prevention.
  //
  // Lifecycle of the `planned` rows inserted here: they reserve stock (the
  // availability views subtract planned + completed allocations) until the
  // order transitions — `orders → fulfilled` completes them and stamps the
  // removed volume for TTB, `orders → cancelled` releases them (see
  // src/services/transition-side-effects.ts).
  const allocateMutation = useMutation({
    mutationFn: async (entries: AllocationEntry[]) => {
      const validEntries = entries.filter((e) => e.quantity > 0);

      if (validEntries.length === 0) {
        throw new Error("No allocations to create");
      }

      // Check for existing allocations of the same lots to this order
      const fgIds = validEntries.map((e) => e.finished_good_id);
      const existing = await unwrap(supabase
        .from("allocations")
        .select("source_id")
        .eq("destination_type", "order")
        .eq("destination_id", orderId)
        .eq("source_type", "finished_good")
        .in("source_id", fgIds)
        .in("status", ["planned", "completed"]));

      const alreadyAllocated = new Set((existing ?? []).map((a) => a.source_id));
      if (alreadyAllocated.size > 0) {
        const duplicateEntries = validEntries.filter((e) => alreadyAllocated.has(e.finished_good_id));
        if (duplicateEntries.length === validEntries.length) {
          throw new Error("All selected lots are already allocated to this order");
        }
        // Filter out duplicates and warn the user
        const filteredEntries = validEntries.filter((e) => !alreadyAllocated.has(e.finished_good_id));
        toast.warning(
          `${duplicateEntries.length} lot(s) already allocated to this order — skipped`
        );
        if (filteredEntries.length === 0) return;
        // Continue with non-duplicate entries
        const allocationsToInsert = filteredEntries.map((entry) => ({
          source_type: "finished_good" as const,
          source_id: entry.finished_good_id,
          destination_type: "order" as const,
          destination_id: orderId,
          quantity: entry.quantity,
          status: "planned" as const,
        }));

        await unwrap(supabase
          .from("allocations")
          .insert(allocationsToInsert));
        return;
      }

      const allocationsToInsert = validEntries.map((entry) => ({
        source_type: "finished_good" as const,
        source_id: entry.finished_good_id,
        destination_type: "order" as const,
        destination_id: orderId,
        quantity: entry.quantity,
        status: "planned" as const,
      }));

      await unwrap(supabase
        .from("allocations")
        .insert(allocationsToInsert));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
      // Prefix-matches the allocatedLots sub-key too
      queryClient.invalidateQueries({ queryKey: orderKeys.allocations(orderId) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.finishedGoods() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.finishedGoodsAvailable() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.allocations() });
      toast.success("Inventory allocated successfully");
      setAllocations({});
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      log.error("Allocation error:", error);
      const message = error instanceof Error ? error.message : "Failed to allocate inventory";
      toast.error(`Failed to allocate inventory: ${message}`);
    },
  });

  // Handle quantity change
  const handleQuantityChange = (fgId: string, available: number, value: string) => {
    const qty = parseInt(value) || 0;
    // Validate against available
    const validQty = Math.min(Math.max(0, qty), available);
    setAllocations((prev) => ({
      ...prev,
      [fgId]: validQty,
    }));
  };

  // Handle save
  const handleSave = () => {
    const entries = Object.entries(allocations)
      .filter(([, qty]) => qty > 0)
      .map(([fgId, qty]) => ({
        finished_good_id: fgId,
        quantity: qty,
      }));

    if (entries.length === 0) {
      toast.error("Please enter at least one allocation quantity");
      return;
    }

    allocateMutation.mutate(entries);
  };

  // Calculate total allocated
  const totalAllocated = Object.values(allocations).reduce((sum, qty) => sum + qty, 0);

  // Per-line demand: ordered minus existing planned/completed allocations
  const demandLines = useMemo(
    () => computeDemandLines(orderItems ?? [], existingAllocations ?? []),
    [orderItems, existingAllocations]
  );

  // Lots already allocated to this order — the save path skips them, so the
  // auto-fill must too, and their inputs are disabled below.
  const allocatedLotIds = useMemo(() => {
    const set = new Set<string>();
    for (const a of existingAllocations ?? []) {
      if (a.source_id) set.add(a.source_id);
    }
    return set;
  }, [existingAllocations]);

  // Only show lots matching the order's line items. Fall back to all lots
  // when the order has no lines with both brand and format (TBD lines), so
  // ad-hoc manual allocation stays possible.
  const hasResolvableLines = demandLines.length > 0;
  const filteredGoods = useMemo(() => {
    if (!finishedGoods) return [];
    if (!hasResolvableLines) return finishedGoods;
    const combos = new Set(
      demandLines.map((l) => comboKey(l.brandId, l.sellingFormatId))
    );
    return finishedGoods.filter((fg) =>
      combos.has(comboKey(fg.brand_id, fg.selling_format_id))
    );
  }, [finishedGoods, demandLines, hasResolvableLines]);

  // FIFO pre-fill (oldest lots first, capped at each line's remaining qty)
  const autoFill = useMemo(
    () => computeFifoFill(demandLines, filteredGoods, allocatedLotIds),
    [demandLines, filteredGoods, allocatedLotIds]
  );
  const canAutoFill = Object.keys(autoFill).length > 0;

  const handleAutoAllocate = () => {
    if (!canAutoFill) {
      toast.info("Nothing to auto-allocate — lines are covered or no matching stock");
      return;
    }
    setAllocations(autoFill);
  };

  // Pre-compute lookup maps to avoid O(n²) .find() per row
  const brandMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of brands ?? []) map.set(b.id, b.name);
    return map;
  }, [brands]);

  const formatMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of packagingFormats ?? []) map.set(f.id, f.name);
    return map;
  }, [packagingFormats]);

  const getBrandName = (id: string) => brandMap.get(id) || "—";
  const getFormatName = (id: string) => formatMap.get(id) || "—";

  const isLoading = itemsLoading || allocLoading || fgLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Allocate Inventory
          </DialogTitle>
          <DialogDescription>
            {hasResolvableLines
              ? "Lots are filtered to this order's line items and sorted oldest-first (FIFO)."
              : "Select finished goods to allocate to this order. Oldest lots are shown first (FIFO)."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : filteredGoods.length > 0 ? (
          <div className="space-y-4">
            {/* Order demand summary + FIFO auto-fill */}
            {hasResolvableLines && (
              <div className="rounded-lg border">
                <div className="flex items-center justify-between p-3 pb-0">
                  <span className="text-sm font-medium">Order needs</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAutoAllocate}
                    disabled={!canAutoFill}
                  >
                    <Wand2 className="h-4 w-4 mr-2" />
                    Auto-allocate (FIFO)
                  </Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Line</TableHead>
                      <TableHead className="text-right">Ordered</TableHead>
                      <TableHead className="text-right">Allocated</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {demandLines.map((line) => (
                      <TableRow key={comboKey(line.brandId, line.sellingFormatId)}>
                        <TableCell>
                          <div className="font-medium">{getBrandName(line.brandId)}</div>
                          <div className="text-xs text-muted-foreground">
                            {getFormatName(line.sellingFormatId)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{line.ordered}</TableCell>
                        <TableCell className="text-right">{line.allocated}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={line.remaining > 0 ? "default" : "secondary"}>
                            {line.remaining}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {!hasResolvableLines && (
              <p className="text-sm text-muted-foreground">
                This order has no line items with a brand and format yet — showing
                all available lots for manual allocation.
              </p>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lot</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead>Format</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="w-[120px]">Allocate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredGoods.map((fg) => {
                  const alreadyAllocated = allocatedLotIds.has(fg.id);
                  return (
                    <TableRow key={fg.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{fg.lot_number}</div>
                          {fg.production_date && (
                            <div className="text-xs text-muted-foreground">
                              {new Date(fg.production_date).toLocaleDateString("en-US")}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{getBrandName(fg.brand_id)}</TableCell>
                      <TableCell>{getFormatName(fg.selling_format_id)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline">{fg.available_quantity}</Badge>
                      </TableCell>
                      <TableCell>
                        {alreadyAllocated ? (
                          <Badge variant="secondary" className="whitespace-nowrap">
                            Already allocated
                          </Badge>
                        ) : (
                          <Input
                            type="number"
                            min={0}
                            max={fg.available_quantity}
                            value={allocations[fg.id] || ""}
                            onChange={(e) =>
                              handleQuantityChange(fg.id, fg.available_quantity, e.target.value)
                            }
                            placeholder="0"
                            className="h-8 w-full"
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {/* Total */}
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <span className="font-medium">Total to Allocate</span>
              <Badge variant={totalAllocated > 0 ? "default" : "secondary"}>
                {totalAllocated} units
              </Badge>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-muted-foreground">
              {hasResolvableLines && (finishedGoods?.length ?? 0) > 0
                ? "No finished goods in stock match this order's line items."
                : "No finished goods available for allocation."}
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
            disabled={allocateMutation.isPending || totalAllocated === 0}
            className="min-h-[44px]"
          >
            {allocateMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Allocating...
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                Allocate ({totalAllocated})
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
