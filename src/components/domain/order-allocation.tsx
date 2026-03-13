"use client";

/**
 * OrderAllocation - Allocate finished goods to an order
 *
 * Features:
 * - Shows available finished goods by brand/selling format
 * - FIFO suggestion (oldest lots first)
 * - Quantity input validated against available
 * - Creates allocation records on save
 */

import { useState, useMemo } from "react";
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
import { Loader2, Package, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { orderKeys, inventoryKeys } from "@/lib/query-keys";
import { dynamicFrom } from "@/services/types";
import { useBrands, usePackagingFormats } from "@/hooks/use-catalog";
import { log } from "@/lib/client-logger";

// =============================================================================
// Types
// =============================================================================

interface FinishedGoodAvailable {
  id: string;
  lot_number: string;
  brand_id: string;
  selling_format_id: string;
  quantity: number;
  available_quantity: number;
  production_date: string | null;
}

interface AllocationEntry {
  finished_good_id: string;
  quantity: number;
}

interface OrderAllocationProps {
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

  // Fetch order details
  const { isLoading: orderLoading } = useQuery({
    queryKey: orderKeys.detail(orderId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("id", orderId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Fetch available finished goods (sorted by production date - FIFO)
  const { data: finishedGoods, isLoading: fgLoading } = useQuery({
    queryKey: inventoryKeys.finishedGoodsAvailable(),
    queryFn: async () => {
      const { data, error } = await dynamicFrom(supabase, "finished_goods_with_availability")
        .select("id, lot_number, brand_id, selling_format_id, quantity, available_quantity, production_date")
        .gt("available_quantity", 0)
        .order("production_date", { ascending: true });

      if (error) throw error;
      return data as FinishedGoodAvailable[];
    },
    enabled: open,
  });

  // Fetch brands and packaging formats for display
  const { data: brands } = useBrands();
  const { data: packagingFormats } = usePackagingFormats();

  // Create allocations mutation
  const allocateMutation = useMutation({
    mutationFn: async (entries: AllocationEntry[]) => {
      const allocationsToInsert = entries
        .filter((e) => e.quantity > 0)
        .map((entry) => ({
          source_type: "finished_good",
          source_id: entry.finished_good_id,
          destination_type: "order",
          destination_id: orderId,
          quantity: entry.quantity,
          status: "planned",
        }));

      if (allocationsToInsert.length === 0) {
        throw new Error("No allocations to create");
      }

      const { error } = await supabase
        .from("allocations")
        .insert(allocationsToInsert);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.finishedGoods() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.allocations() });
      toast.success("Inventory allocated successfully");
      setAllocations({});
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      log.error("Allocation error:", error);
      toast.error("Failed to allocate inventory");
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

  const isLoading = orderLoading || fgLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Allocate Inventory
          </DialogTitle>
          <DialogDescription>
            Select finished goods to allocate to this order. Oldest lots are shown first (FIFO).
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : finishedGoods && finishedGoods.length > 0 ? (
          <div className="space-y-4">
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
                {finishedGoods.map((fg) => (
                  <TableRow key={fg.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{fg.lot_number}</div>
                        {fg.production_date && (
                          <div className="text-xs text-muted-foreground">
                            {new Date(fg.production_date).toLocaleDateString()}
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
                    </TableCell>
                  </TableRow>
                ))}
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
            <p className="text-muted-foreground">No finished goods available for allocation.</p>
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
