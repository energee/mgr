"use client";

/**
 * PO Accept into Inventory Dialog
 *
 * After PO items are received (po_receives), this dialog allows the user
 * to "accept" them into inventory by creating inventory_lots records.
 * Each inventory lot is linked back to its po_receive via po_receive_id,
 * enabling the landed cost calculation pipeline.
 *
 * The user selects which received items to accept, maps each to an
 * inventory_item, and optionally sets a storage location.
 */

import { useState, useCallback, useMemo } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, PackageCheck, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
  CATALOG_TABLES,
  isFreeTextCatalogType,
} from "@/entities/po-line-item";
import { poReceiveKeys, entityKeys } from "@/lib/query-keys";

// =============================================================================
// Types
// =============================================================================

interface UnacceptedReceive {
  receive_id: string;
  po_line_item_id: string;
  catalog_type: string;
  catalog_id: string;
  catalog_name: string; // resolved client-side
  quantity: number;
  unit: string;
  unit_price: number | null;
  lot_number: string | null;
  expiration_date: string | null;
  received_date: string | null;
}

interface RowState {
  selected: boolean;
  inventory_item_id: string;
  location: string;
}

interface POAcceptInventoryDialogProps {
  poId: string;
  open: boolean;
  onClose: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function POAcceptInventoryDialog({
  poId,
  open,
  onClose,
}: POAcceptInventoryDialogProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  // Per-row state: selected, inventory_item_id, location
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  // RPC return type (matches get_unaccepted_po_receives SQL function)
  type RpcReceiveRow = {
    receive_id: string;
    po_line_item_id: string;
    catalog_type: string;
    catalog_id: string;
    quantity: number;
    unit: string;
    unit_price: number | null;
    lot_number: string | null;
    expiration_date: string | null;
    received_date: string | null;
  };

  // Fetch unaccepted receives via RPC
  const { data: receives, isLoading: receivesLoading } = useQuery({
    queryKey: poReceiveKeys.unaccepted(poId),
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)(
        "get_unaccepted_po_receives",
        { p_po_id: poId }
      ) as { data: RpcReceiveRow[] | null; error: Error | null };

      if (error) throw error;
      if (!data || data.length === 0) return [] as UnacceptedReceive[];

      // Resolve catalog names (same pattern as po-receiving.tsx)
      const itemsByType = new Map<
        string,
        { catalog_id: string; receive_id: string }[]
      >();
      for (const row of data) {
        const existing = itemsByType.get(row.catalog_type) ?? [];
        existing.push({
          catalog_id: row.catalog_id,
          receive_id: row.receive_id,
        });
        itemsByType.set(row.catalog_type, existing);
      }

      const nameMap = new Map<string, string>();
      for (const [catalogType, items] of itemsByType) {
        if (isFreeTextCatalogType(catalogType)) {
          for (const item of items) {
            nameMap.set(
              `${catalogType}:${item.catalog_id}`,
              item.catalog_id
            );
          }
          continue;
        }

        const table = CATALOG_TABLES[catalogType];
        if (!table) continue;

        const catalogIds = [...new Set(items.map((i) => i.catalog_id))];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: catalogItems } = await (supabase as any)
          .from(table)
          .select("id, name")
          .in("id", catalogIds);

        for (const ci of catalogItems ?? []) {
          nameMap.set(`${catalogType}:${ci.id}`, ci.name);
        }
      }

      return data.map((row) => ({
        ...row,
        catalog_name:
          nameMap.get(`${row.catalog_type}:${row.catalog_id}`) ??
          row.catalog_id,
      })) as UnacceptedReceive[];
    },
    enabled: open,
  });

  // Fetch inventory items for the dropdown
  const { data: inventoryItems, isLoading: itemsLoading } = useQuery({
    queryKey: entityKeys.list("inventory_items"),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, name, category, unit")
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });

  // Helpers
  const updateRow = useCallback(
    (receiveId: string, updates: Partial<RowState>) => {
      setRowStates((prev) => ({
        ...prev,
        [receiveId]: {
          selected: prev[receiveId]?.selected ?? false,
          inventory_item_id: prev[receiveId]?.inventory_item_id ?? "",
          location: prev[receiveId]?.location ?? "",
          ...updates,
        },
      }));
    },
    []
  );

  const selectedReceives = useMemo(() => {
    if (!receives) return [];
    return receives.filter((r) => rowStates[r.receive_id]?.selected);
  }, [receives, rowStates]);

  const allSelected = useMemo(
    () =>
      receives &&
      receives.length > 0 &&
      receives.every((r) => rowStates[r.receive_id]?.selected),
    [receives, rowStates]
  );

  const toggleAll = useCallback(() => {
    if (!receives) return;
    const newSelected = !allSelected;
    setRowStates((prev) => {
      const next = { ...prev };
      for (const r of receives) {
        next[r.receive_id] = {
          ...(next[r.receive_id] ?? {
            inventory_item_id: "",
            location: "",
          }),
          selected: newSelected,
        };
      }
      return next;
    });
  }, [receives, allSelected]);

  // Validation: all selected rows must have an inventory_item_id
  const canSubmit = useMemo(() => {
    return (
      selectedReceives.length > 0 &&
      selectedReceives.every(
        (r) => rowStates[r.receive_id]?.inventory_item_id
      )
    );
  }, [selectedReceives, rowStates]);

  // Mutation: create inventory_lots
  const acceptMutation = useMutation({
    mutationFn: async () => {
      const lotsToInsert = selectedReceives.map((r) => {
        const state = rowStates[r.receive_id];
        return {
          inventory_item_id: state.inventory_item_id,
          po_receive_id: r.receive_id,
          quantity: r.quantity,
          unit: r.unit,
          unit_cost: r.unit_price,
          lot_number: r.lot_number,
          expiration_date: r.expiration_date,
          received_date: r.received_date,
          location: state.location || null,
        };
      });

      const { error } = await supabase
        .from("inventory_lots")
        .insert(lotsToInsert);

      if (error) throw error;
    },
    onSuccess: () => {
      const count = selectedReceives.length;
      toast.success(
        `${count} item${count !== 1 ? "s" : ""} accepted into inventory`
      );
      queryClient.invalidateQueries({
        queryKey: poReceiveKeys.unaccepted(poId),
      });
      queryClient.invalidateQueries({
        queryKey: entityKeys.all("inventory_lots"),
      });
      setRowStates({});
      onClose();
    },
    onError: (error) => {
      console.error("Accept into inventory error:", error);
      toast.error("Failed to accept items into inventory");
    },
  });

  const isLoading = receivesLoading || itemsLoading;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-5xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5" />
            Accept into Inventory
          </DialogTitle>
          <DialogDescription>
            Select received items to create inventory lot records. Each item
            must be mapped to an inventory item.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : receives && receives.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected ?? false}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Lot #</TableHead>
                <TableHead>Expiration</TableHead>
                <TableHead className="min-w-[200px]">
                  Inventory Item
                </TableHead>
                <TableHead className="w-[140px]">Location</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {receives.map((r) => {
                const state = rowStates[r.receive_id];
                const isSelected = state?.selected ?? false;

                return (
                  <TableRow key={r.receive_id}>
                    <TableCell>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) =>
                          updateRow(r.receive_id, {
                            selected: !!checked,
                          })
                        }
                        aria-label={`Select ${r.catalog_name}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      {r.catalog_name}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.quantity} {r.unit}
                    </TableCell>
                    <TableCell>{r.lot_number || "—"}</TableCell>
                    <TableCell>{r.expiration_date || "—"}</TableCell>
                    <TableCell>
                      <Select
                        value={state?.inventory_item_id || undefined}
                        onValueChange={(v) =>
                          updateRow(r.receive_id, {
                            inventory_item_id: v,
                          })
                        }
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue placeholder="Select item..." />
                        </SelectTrigger>
                        <SelectContent>
                          {inventoryItems?.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="text"
                        value={state?.location || ""}
                        onChange={(e) =>
                          updateRow(r.receive_id, {
                            location: e.target.value,
                          })
                        }
                        className="h-8"
                        placeholder="e.g. Shelf A"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-muted-foreground">
              No unaccepted receives for this purchase order.
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              All received items have already been accepted into inventory, or
              no items have been received yet.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            className="min-h-[44px]"
          >
            Cancel
          </Button>
          <Button
            onClick={() => acceptMutation.mutate()}
            disabled={!canSubmit || acceptMutation.isPending}
            className="min-h-[44px]"
          >
            {acceptMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <PackageCheck className="h-4 w-4 mr-2" />
                Accept Selected ({selectedReceives.length})
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
