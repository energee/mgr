"use client";

/**
 * PickListItems - Interactive pick list items for warehouse operations
 *
 * Displays items to pick with quantities, locations, and picking controls.
 * Sorted by location for efficient warehouse travel.
 * Supports marking items as picked with quantity tracking.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { pickListKeys } from "@/lib/query-keys";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Package,
  MapPin,
  CheckCircle2,
  Circle,
  Loader2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

// =============================================================================
// Types
// =============================================================================

interface PickListItemRow {
  id: string;
  pick_list_id: string;
  order_item_id: string;
  finished_good_id: string;
  location_id: string | null;
  quantity_requested: number;
  quantity_picked: number;
  picked_at: string | null;
  notes: string | null;
  sort_order: number;
  // Joined fields
  lot_number?: string;
  brand_name?: string;
  package_name?: string;
  location_name?: string;
  production_date?: string;
}

interface PickListItemsProps {
  data: {
    id: string;
    status: string;
  };
}

// =============================================================================
// Component
// =============================================================================

export function PickListItems({ data }: PickListItemsProps) {
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const queryClient = useQueryClient();
  const pickListId = data.id;
  const isEditable = ["draft", "assigned", "in_progress"].includes(data.status);

  const [pendingPicks, setPendingPicks] = useState<Record<string, number>>({});

  // Fetch pick list items with related data
  const { data: items = [], isLoading } = useQuery<PickListItemRow[]>({
    queryKey: pickListKeys.items(pickListId),
    queryFn: async () => {
      const { data: pickItems, error } = await db
        .from("pick_list_items")
        .select(`
          id,
          pick_list_id,
          order_item_id,
          finished_good_id,
          location_id,
          quantity_requested,
          quantity_picked,
          picked_at,
          notes,
          sort_order
        `)
        .eq("pick_list_id", pickListId)
        .order("sort_order", { ascending: true });

      if (error) throw error;
      if (!pickItems || pickItems.length === 0) return [];

      // Get finished goods details
      const fgIds = [...new Set(pickItems.map((i: PickListItemRow) => i.finished_good_id))] as string[];
      const locationIds = [...new Set(pickItems.map((i: PickListItemRow) => i.location_id).filter(Boolean))] as string[];

      const [fgResult, locationResult] = await Promise.all([
        supabase
          .from("finished_goods")
          .select("id, lot_number, brand_id, package_type_id, production_date")
          .in("id", fgIds),
        locationIds.length > 0
          ? supabase.from("locations").select("id, name").in("id", locationIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ]);

      const fgMap = new Map((fgResult.data || []).map((fg) => [fg.id, fg]));
      const locationMap = new Map((locationResult.data || []).map((l) => [l.id, l.name]));

      // Get brand and package type names
      const brandIds = [...new Set((fgResult.data || []).map((fg) => fg.brand_id).filter(Boolean))];
      const packageIds = [...new Set((fgResult.data || []).map((fg) => fg.package_type_id).filter(Boolean))];

      const [brandsResult, packagesResult] = await Promise.all([
        brandIds.length > 0
          ? supabase.from("brands").select("id, name").in("id", brandIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        packageIds.length > 0
          ? supabase.from("package_types").select("id, name").in("id", packageIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ]);

      const brandMap = new Map((brandsResult.data || []).map((b) => [b.id, b.name]));
      const packageMap = new Map((packagesResult.data || []).map((p) => [p.id, p.name]));

      return pickItems.map((item: PickListItemRow) => {
        const fg = fgMap.get(item.finished_good_id);
        return {
          ...item,
          lot_number: fg?.lot_number || "N/A",
          brand_name: fg ? brandMap.get(fg.brand_id) || "Unknown" : "Unknown",
          package_name: fg ? packageMap.get(fg.package_type_id) || "Unknown" : "Unknown",
          location_name: item.location_id ? locationMap.get(item.location_id) || null : null,
          production_date: fg?.production_date || null,
        } as PickListItemRow;
      });
    },
  });

  // Mutation to update picked quantity
  const updatePickedMutation = useMutation({
    mutationFn: async ({ itemId, quantity }: { itemId: string; quantity: number }) => {
      const { error } = await db
        .from("pick_list_items")
        .update({
          quantity_picked: quantity,
          picked_at: quantity > 0 ? new Date().toISOString() : null,
        })
        .eq("id", itemId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pickListKeys.items(pickListId) });
      queryClient.invalidateQueries({ queryKey: pickListKeys.detail(pickListId) });
    },
    onError: (error) => {
      toast.error(`Failed to update: ${error.message}`);
    },
  });

  // Mark single item as fully picked
  const markPicked = (item: PickListItemRow) => {
    const newQty = item.quantity_picked >= item.quantity_requested ? 0 : item.quantity_requested;
    updatePickedMutation.mutate({ itemId: item.id, quantity: newQty });
  };

  // Save a pending pick quantity
  const savePendingPick = (itemId: string) => {
    const quantity = pendingPicks[itemId];
    if (quantity !== undefined) {
      updatePickedMutation.mutate({ itemId, quantity });
      setPendingPicks((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
    }
  };

  // Complete all items
  const completeAllMutation = useMutation({
    mutationFn: async () => {
      const unpicked = items.filter((i: PickListItemRow) => i.quantity_picked < i.quantity_requested);
      for (const item of unpicked) {
        const { error } = await db
          .from("pick_list_items")
          .update({
            quantity_picked: item.quantity_requested,
            picked_at: new Date().toISOString(),
          })
          .eq("id", item.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pickListKeys.items(pickListId) });
      queryClient.invalidateQueries({ queryKey: pickListKeys.detail(pickListId) });
      toast.success("All items marked as picked");
    },
    onError: (error) => {
      toast.error(`Failed to complete: ${error.message}`);
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Package className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-lg font-medium">No items on this pick list</p>
          <p className="text-muted-foreground">
            Generate a pick list from an order to populate items.
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalRequested = items.reduce((sum, i) => sum + i.quantity_requested, 0);
  const totalPicked = items.reduce((sum, i) => sum + i.quantity_picked, 0);
  const completedCount = items.filter((i) => i.quantity_picked >= i.quantity_requested).length;

  return (
    <div className="space-y-4">
      {/* Progress Summary */}
      <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-500" />
          <span className="font-medium">Progress</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-lg font-bold">
              {completedCount} / {items.length}
            </div>
            <div className="text-sm text-muted-foreground">items complete</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold">
              {totalPicked} / {totalRequested}
            </div>
            <div className="text-sm text-muted-foreground">units picked</div>
          </div>
        </div>
      </div>

      {/* Actions */}
      {isEditable && completedCount < items.length && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={() => completeAllMutation.mutate()}
            disabled={completeAllMutation.isPending}
          >
            {completeAllMutation.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Mark All Picked
          </Button>
        </div>
      )}

      {/* Items Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              {isEditable && <TableHead className="w-[50px]">Pick</TableHead>}
              <TableHead>Product</TableHead>
              <TableHead>Lot #</TableHead>
              <TableHead className="text-center">
                <span className="flex items-center gap-1 justify-center">
                  <MapPin className="h-4 w-4" />
                  Location
                </span>
              </TableHead>
              <TableHead className="text-right">Requested</TableHead>
              <TableHead className="text-right">Picked</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const isComplete = item.quantity_picked >= item.quantity_requested;
              return (
                <TableRow
                  key={item.id}
                  className={isComplete ? "bg-green-50 dark:bg-green-950/20" : ""}
                >
                  {isEditable && (
                    <TableCell>
                      <button
                        onClick={() => markPicked(item)}
                        className="p-1 hover:bg-muted rounded"
                        disabled={updatePickedMutation.isPending}
                      >
                        {isComplete ? (
                          <CheckCircle2 className="h-6 w-6 text-green-500" />
                        ) : (
                          <Circle className="h-6 w-6 text-muted-foreground" />
                        )}
                      </button>
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="font-medium">{item.brand_name}</div>
                    <div className="text-sm text-muted-foreground">
                      {item.package_name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-mono text-sm">{item.lot_number}</div>
                    {item.production_date && (
                      <div className="text-xs text-muted-foreground">
                        {new Date(item.production_date).toLocaleDateString()}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {item.location_name ? (
                      <Badge variant="secondary" className="font-mono">
                        {item.location_name}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">--</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {item.quantity_requested}
                  </TableCell>
                  <TableCell className="text-right">
                    {isEditable ? (
                      <div className="flex items-center justify-end gap-2">
                        <Input
                          type="number"
                          min={0}
                          max={item.quantity_requested}
                          value={pendingPicks[item.id] ?? item.quantity_picked}
                          onChange={(e) =>
                            setPendingPicks((prev) => ({
                              ...prev,
                              [item.id]: Number(e.target.value),
                            }))
                          }
                          onBlur={() => savePendingPick(item.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") savePendingPick(item.id);
                          }}
                          className="w-20 text-right"
                        />
                      </div>
                    ) : (
                      <span className={isComplete ? "text-green-600 font-bold" : ""}>
                        {item.quantity_picked}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
