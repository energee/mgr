"use client";

/**
 * PickListItems - Interactive pick list items for warehouse operations
 *
 * Displays items to pick with quantities, locations, and picking controls.
 * Sorted by location for efficient warehouse travel.
 * Supports marking items as picked with quantity tracking, and once every
 * line is fully picked on an in-progress list, offers a "Complete Pick List"
 * button that transitions the list and runs the shared transition side
 * effects (services/transition-side-effects.ts), which also move the parent
 * order picking → packed.
 *
 * Built for hands-on warehouse use (audit F-38):
 * - a keyboard-wedge scan field (shared/scan-input.tsx) matches scanned lot
 *   numbers via resolvePickScan and marks the line picked, scrolling it
 *   into view;
 * - below the md breakpoint (useIsMobile) lines render as cards with a
 *   large "Picked" button and +/- quantity steppers instead of the table;
 * - on coarse-pointer devices (useIsTouch, e.g. tablets that keep the
 *   table) the pick toggle and quantity inputs get enlarged hit areas.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { unwrap } from "@/lib/supabase/query-helpers";
import { entityKeys, pickListKeys } from "@/lib/query-keys";
import { dynamicFrom, formatServiceError } from "@/services/types";
import { entityService } from "@/services/entity-service";
import { pickListEntity } from "@/entities/pick-list";
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
  Minus,
  Plus,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useIsMobile, useIsTouch } from "@/hooks/use-mobile";
import { ScanInput } from "@/components/domain/shared/scan-input";
import { resolvePickScan } from "./pick-list-scan";

// =============================================================================
// Types
// =============================================================================

type PickListItemRow = {
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

type PickListItemsProps = {
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
  const queryClient = useQueryClient();
  const pickListId = data.id;
  const isEditable = ["draft", "assigned", "in_progress"].includes(data.status);
  const isMobile = useIsMobile();
  const isTouch = useIsTouch();

  const [pendingPicks, setPendingPicks] = useState<Record<string, number>>({});
  // Last line resolved from a lot-number scan — highlighted + scrolled into view
  const [lastScanId, setLastScanId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());

  // Fetch pick list items with related data
  const { data: items = [], isLoading } = useQuery<PickListItemRow[]>({
    queryKey: pickListKeys.items(pickListId),
    queryFn: async () => {
      const pickItems = await unwrap(dynamicFrom(supabase, "pick_list_items")
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
        .order("sort_order", { ascending: true })) as unknown as PickListItemRow[];

      if (!pickItems || pickItems.length === 0) return [];

      // Get finished goods details
      const fgIds = [...new Set(pickItems.map((i: PickListItemRow) => i.finished_good_id))] as string[];
      const locationIds = [...new Set(pickItems.map((i: PickListItemRow) => i.location_id).filter(Boolean))] as string[];

      const [fgResult, locationResult] = await Promise.all([
        supabase
          .from("finished_goods")
          .select("id, lot_number, brand_id, selling_format_id, production_date")
          .in("id", fgIds),
        locationIds.length > 0
          ? supabase.from("locations").select("id, name").in("id", locationIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ]);

      const fgMap = new Map((fgResult.data || []).map((fg) => [fg.id, fg]));
      const locationMap = new Map((locationResult.data || []).map((l) => [l.id, l.name]));

      // Get brand and package type names
      const brandIds = [...new Set((fgResult.data || []).map((fg) => fg.brand_id).filter((id): id is string => !!id))];
      const formatIds = [...new Set((fgResult.data || []).map((fg) => fg.selling_format_id).filter((id): id is string => !!id))];

      const [brandsResult, formatsResult] = await Promise.all([
        brandIds.length > 0
          ? supabase.from("brands").select("id, name").in("id", brandIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        formatIds.length > 0
          ? supabase.from("selling_formats").select("id, name").in("id", formatIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ]);

      const brandMap = new Map((brandsResult.data || []).map((b) => [b.id, b.name]));
      const formatMap = new Map((formatsResult.data || []).map((f) => [f.id, f.name]));

      return pickItems.map((item: PickListItemRow) => {
        const fg = fgMap.get(item.finished_good_id);
        return {
          ...item,
          lot_number: fg?.lot_number || "N/A",
          brand_name: fg?.brand_id ? brandMap.get(fg.brand_id) || "Unknown" : "Unknown",
          package_name: fg?.selling_format_id ? formatMap.get(fg.selling_format_id) || "Unknown" : "Unknown",
          location_name: item.location_id ? locationMap.get(item.location_id) || null : null,
          production_date: fg?.production_date || null,
        } as PickListItemRow;
      });
    },
  });

  // Mutation to update picked quantity
  const updatePickedMutation = useMutation({
    mutationFn: async ({ itemId, quantity }: { itemId: string; quantity: number }) => {
      await unwrap(dynamicFrom(supabase, "pick_list_items")
        .update({
          quantity_picked: quantity,
          picked_at: quantity > 0 ? new Date().toISOString() : null,
        })
        .eq("id", itemId));
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

  // Step the picked quantity by ±1 (mobile card steppers). Commits
  // immediately — any unsaved typed value for the row is superseded.
  const stepPick = (item: PickListItemRow, delta: number) => {
    const current = pendingPicks[item.id] ?? item.quantity_picked;
    const next = Math.min(
      item.quantity_requested,
      Math.max(0, current + delta)
    );
    if (next === current) return;
    setPendingPicks((prev) => {
      const rest = { ...prev };
      delete rest[item.id];
      return rest;
    });
    updatePickedMutation.mutate({ itemId: item.id, quantity: next });
  };

  // Keyboard-wedge scan: match the code against lot numbers, mark the first
  // unpicked matching line fully picked, and bring its row into view.
  const handleScan = (code: string) => {
    const result = resolvePickScan(items, code);
    if (result.kind === "not_found") {
      toast.error(`No pick line matches "${code}"`);
      return;
    }
    setLastScanId(result.item.id);
    rowRefs.current
      .get(result.item.id)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (result.kind === "already_picked") {
      toast.info(`Lot ${result.item.lot_number} is already fully picked`);
      return;
    }
    const { item } = result;
    updatePickedMutation.mutate(
      { itemId: item.id, quantity: item.quantity_requested },
      {
        onSuccess: () =>
          toast.success(
            `Picked ${item.quantity_requested} × lot ${item.lot_number}`
          ),
      }
    );
  };

  // Register a row/card element for scan scroll-into-view
  const registerRow = (id: string) => (el: HTMLElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
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

  // Complete all items in a single batch update per unique quantity
  const completeAllMutation = useMutation({
    mutationFn: async () => {
      const unpicked = items.filter((i: PickListItemRow) => i.quantity_picked < i.quantity_requested);
      if (unpicked.length === 0) return;

      // Group by quantity_requested so we can batch updates
      const byQuantity = new Map<number, string[]>();
      for (const item of unpicked) {
        const ids = byQuantity.get(item.quantity_requested) || [];
        ids.push(item.id);
        byQuantity.set(item.quantity_requested, ids);
      }

      const now = new Date().toISOString();
      const updates = Array.from(byQuantity.entries()).map(([qty, ids]) =>
        unwrap(dynamicFrom(supabase, "pick_list_items")
          .update({
            quantity_picked: qty,
            picked_at: now,
          })
          .in("id", ids))
      );

      await Promise.all(updates);
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

  // Complete the pick list once every line is fully picked. Mirrors the
  // batch detail page pattern (production/batches/[id]/page.tsx): a
  // status-guarded UPDATE so a concurrent transition matches 0 rows instead
  // of clobbering, then the shared transition side effects, which sync the
  // parent order picking → packed and invalidate order caches.
  const completePickListMutation = useMutation({
    mutationFn: async () => {
      const result = await entityService.transition(
        supabase,
        pickListEntity,
        pickListId,
        "completed"
      );
      if (!result.success) throw new Error(formatServiceError(result.error));
    },
    onSuccess: () => {
      toast.success("Pick list completed");
      // entityKeys cover the generic detail page (table + view) and lists;
      // pickListKeys cover the order-page pick list panels.
      queryClient.invalidateQueries({ queryKey: entityKeys.all("pick_lists") });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("pick_list_details") });
      queryClient.invalidateQueries({ queryKey: pickListKeys.all() });
    },
    onError: (error) => {
      toast.error(`Failed to complete pick list: ${error.message}`);
      // Refetch so the UI reflects whichever state won the race
      queryClient.invalidateQueries({ queryKey: entityKeys.all("pick_lists") });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("pick_list_details") });
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

      {/* Keyboard-wedge scan entry: scanners type the lot number + Enter */}
      {isEditable && (
        <ScanInput
          onScan={handleScan}
          placeholder="Scan or type a lot number…"
          ariaLabel="Scan lot number"
        />
      )}

      {/* Actions */}
      {isEditable && completedCount < items.length && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={() => completeAllMutation.mutate()}
            disabled={completeAllMutation.isPending}
            className={cn(isMobile && "w-full", isTouch && "min-h-[44px]")}
          >
            {completeAllMutation.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Mark All Picked
          </Button>
        </div>
      )}

      {/* Every line picked on an in-progress list — offer completion here so
          the picker doesn't have to find the status dropdown. Also syncs the
          parent order to "packed" via transition side effects. */}
      {data.status === "in_progress" && completedCount === items.length && (
        <div className="flex justify-end">
          <Button
            onClick={() => completePickListMutation.mutate()}
            disabled={completePickListMutation.isPending}
            className={cn(isMobile && "w-full", isTouch && "min-h-[44px]")}
          >
            {completePickListMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-2" />
            )}
            Complete Pick List
          </Button>
        </div>
      )}

      {/* Items — cards on phones, table on desktop/tablet */}
      {isMobile ? (
        <div className="space-y-3">
          {items.map((item) => {
            const isComplete =
              item.quantity_picked >= item.quantity_requested;
            const currentQty = pendingPicks[item.id] ?? item.quantity_picked;
            return (
              <Card
                key={item.id}
                ref={registerRow(item.id)}
                className={cn(
                  isComplete &&
                    "border-green-500/40 bg-green-50 dark:bg-green-950/20",
                  lastScanId === item.id && "ring-2 ring-primary"
                )}
              >
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium">{item.brand_name}</div>
                      <div className="text-sm text-muted-foreground">
                        {item.package_name}
                      </div>
                    </div>
                    {item.location_name && (
                      <Badge variant="secondary" className="shrink-0 font-mono">
                        <MapPin className="mr-1 h-3 w-3" />
                        {item.location_name}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-mono">{item.lot_number}</span>
                    {item.production_date && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(item.production_date).toLocaleDateString("en-US")}
                      </span>
                    )}
                  </div>
                  {isEditable ? (
                    <>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-11 w-11 shrink-0"
                          aria-label="Decrease picked quantity"
                          onClick={() => stepPick(item, -1)}
                          disabled={
                            updatePickedMutation.isPending || currentQty <= 0
                          }
                        >
                          <Minus className="h-5 w-5" />
                        </Button>
                        <Input
                          type="number"
                          min={0}
                          max={item.quantity_requested}
                          value={currentQty}
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
                          aria-label="Picked quantity"
                          className="h-11 flex-1 text-center text-lg"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-11 w-11 shrink-0"
                          aria-label="Increase picked quantity"
                          onClick={() => stepPick(item, 1)}
                          disabled={
                            updatePickedMutation.isPending ||
                            currentQty >= item.quantity_requested
                          }
                        >
                          <Plus className="h-5 w-5" />
                        </Button>
                        <span className="shrink-0 text-sm text-muted-foreground">
                          / {item.quantity_requested}
                        </span>
                      </div>
                      <Button
                        variant={isComplete ? "outline" : "default"}
                        className="min-h-[48px] w-full"
                        onClick={() => markPicked(item)}
                        disabled={updatePickedMutation.isPending}
                      >
                        {isComplete ? (
                          <>
                            <Circle className="mr-2 h-5 w-5" />
                            Undo Pick
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="mr-2 h-5 w-5" />
                            Picked
                          </>
                        )}
                      </Button>
                    </>
                  ) : (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Picked</span>
                      <span
                        className={cn(
                          "font-medium",
                          isComplete && "font-bold text-green-600"
                        )}
                      >
                        {item.quantity_picked} / {item.quantity_requested}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
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
                    ref={registerRow(item.id)}
                    className={cn(
                      isComplete && "bg-green-50 dark:bg-green-950/20",
                      lastScanId === item.id &&
                        "ring-2 ring-inset ring-primary"
                    )}
                  >
                    {isEditable && (
                      <TableCell>
                        <button
                          onClick={() => markPicked(item)}
                          aria-label={
                            isComplete ? "Mark not picked" : "Mark picked"
                          }
                          className={cn(
                            "p-1 hover:bg-muted rounded",
                            // ≥44px hit area on coarse pointers (WCAG 2.5.5)
                            isTouch && "p-2.5"
                          )}
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
                          {new Date(item.production_date).toLocaleDateString("en-US")}
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
                            aria-label="Picked quantity"
                            className={cn(
                              "w-20 text-right",
                              isTouch && "h-11 w-24"
                            )}
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
      )}
    </div>
  );
}
