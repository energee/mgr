"use client";

/**
 * PO Accept into Inventory Dialog
 *
 * After PO items are received (po_receives), this dialog allows the user
 * to "accept" them into inventory by creating inventory_lots records.
 * Each inventory lot is linked back to its po_receive via po_receive_id,
 * enabling the landed cost calculation pipeline.
 *
 * The user maps each received item to an inventory_item (searchable
 * combobox) and optionally places it in a storage bin. Both pickers are
 * prefilled from the most recent prior acceptance of the same catalog
 * item, resolved through the existing chain
 * inventory_lots.po_receive_id → po_receives.po_line_item_id →
 * po_line_items.catalog_type/catalog_id — so repeat receipts don't re-ask
 * for the same mapping.
 *
 * This file owns the dialog chrome, data fetching, and row-selection
 * state. The row grid (desktop table / mobile cards, item + bin pickers)
 * lives in po-accept-receive-grid.tsx, and the accept write path (lot
 * creation + bin placement + cache invalidation) in
 * use-po-accept-mutation.ts.
 *
 * Hands-on receiving support (audit F-38): a keyboard-wedge scan field
 * (shared/scan-input.tsx) matches scanned lot numbers against the
 * unaccepted receives and selects them.
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicRpc } from "@/services/types";
import { unwrap } from "@/lib/supabase/query-helpers";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormActions } from "@/components/ui/form-actions";
import { Skeleton } from "@/components/ui/skeleton";
import { PackageCheck, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { resolveCatalogNames } from "@/entities/po-line-item";
import { poReceiveKeys, entityKeys, binKeys } from "@/lib/query-keys";
import { ScanInput } from "@/components/domain/shared/scan-input";
import { matchScanCode } from "@/components/domain/shared/scan-match";
import {
  buildMappingDefaults,
  catalogKey,
  type PriorLotRow,
  type UnacceptedReceive,
  type RowState,
} from "@/domain/purchasing/po-accept-utils";
import { useIsMobile, useIsTouch } from "@/hooks/use-mobile";
import { POAcceptReceiveGrid } from "./po-accept-receive-grid";
import { usePoAcceptMutation } from "./use-po-accept-mutation";

type POAcceptInventoryDialogProps = {
  poId: string;
  open: boolean;
  onClose: () => void;
}

export function POAcceptInventoryDialog({
  poId,
  open,
  onClose,
}: POAcceptInventoryDialogProps) {
  const supabase = createClient();
  // Subscribed here and passed down as props so the grid stays free of
  // matchMedia — see the header of po-accept-receive-grid.tsx.
  const isMobile = useIsMobile();
  const isTouch = useIsTouch();

  // Per-row user overrides; rows the user hasn't touched fall back to
  // defaultRowState (prefilled from the last acceptance of the same
  // catalog item).
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  // Reset overrides when dialog opens (clean slate for each session)
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- dialog reset on open is intentional
      setRowStates({});
    }
  }, [open]);

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
      const data = await unwrap(dynamicRpc(supabase, "get_unaccepted_po_receives", { p_po_id: poId }));
      const rows = (data ?? []) as RpcReceiveRow[];
      if (rows.length === 0) return [] as UnacceptedReceive[];

      // Resolve catalog names using shared utility
      const nameMap = await resolveCatalogNames(supabase, rows);

      return rows.map((row: RpcReceiveRow) => ({
        ...row,
        catalog_name:
          nameMap.get(`${row.catalog_type}:${row.catalog_id}`) ??
          row.catalog_id,
      })) as UnacceptedReceive[];
    },
    enabled: open,
  });

  // Fetch inventory items for the item combobox
  const { data: inventoryItems, isLoading: itemsLoading } = useQuery({
    queryKey: entityKeys.list("inventory_items"),
    queryFn: async () => {
      return (await unwrap(
        supabase
          .from("inventory_items")
          .select("id, name, category, unit")
          .eq("is_active", true)
          .order("name")
      )) ?? [];
    },
    enabled: open,
  });

  // Fetch active bins for the bin combobox
  const { data: bins, isLoading: binsLoading } = useQuery({
    queryKey: binKeys.list({ is_active: true }),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bins")
        .select("id, name")
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });

  // Most recent catalog→(inventory item, bin) mapping per catalog item,
  // derived from prior accepted lots — no dedicated mapping table needed.
  const { data: mappingDefaults } = useQuery({
    queryKey: poReceiveKeys.mappingDefaults(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_lots")
        .select(
          "inventory_item_id, po_receive:po_receives!inner(po_line_item:po_line_items!inner(catalog_type, catalog_id)), bin_inventory_items(bin_id)"
        )
        .not("po_receive_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(300);

      if (error) throw error;
      return buildMappingDefaults((data ?? []) as unknown as PriorLotRow[]);
    },
    enabled: open,
  });

  const itemNameById = useMemo(
    () => new Map((inventoryItems ?? []).map((i) => [i.id, i.name])),
    [inventoryItems]
  );
  // Item unit lookup for the received-unit vs item-unit mismatch warning
  const itemUnitById = useMemo(
    () => new Map((inventoryItems ?? []).map((i) => [i.id, i.unit])),
    [inventoryItems]
  );
  const binNameById = useMemo(
    () => new Map((bins ?? []).map((b) => [b.id, b.name])),
    [bins]
  );

  const itemOptions = useMemo(
    () => (inventoryItems ?? []).map((i) => ({ value: i.id, label: i.name })),
    [inventoryItems]
  );
  const binOptions = useMemo(
    () => (bins ?? []).map((b) => ({ value: b.id, label: b.name })),
    [bins]
  );

  // Helpers — effective row state is the user's override, or the prefill
  // default from the last acceptance of the same catalog item (validated
  // against the currently active items/bins).
  const defaultRowState = useCallback(
    (r: UnacceptedReceive): RowState => {
      const prior = mappingDefaults?.get(catalogKey(r.catalog_type, r.catalog_id));
      return {
        selected: false,
        inventory_item_id:
          prior && itemNameById.has(prior.inventory_item_id)
            ? prior.inventory_item_id
            : "",
        bin_id:
          prior?.bin_id && binNameById.has(prior.bin_id) ? prior.bin_id : "",
      };
    },
    [mappingDefaults, itemNameById, binNameById]
  );

  const getRowState = useCallback(
    (r: UnacceptedReceive): RowState =>
      rowStates[r.receive_id] ?? defaultRowState(r),
    [rowStates, defaultRowState]
  );

  const updateRow = useCallback(
    (r: UnacceptedReceive, updates: Partial<RowState>) => {
      setRowStates((prev) => ({
        ...prev,
        [r.receive_id]: {
          ...(prev[r.receive_id] ?? defaultRowState(r)),
          ...updates,
        },
      }));
    },
    [defaultRowState]
  );

  const selectedReceives = useMemo(() => {
    if (!receives) return [];
    return receives.filter((r) => getRowState(r).selected);
  }, [receives, getRowState]);

  const allSelected = useMemo(
    () =>
      !!receives &&
      receives.length > 0 &&
      receives.every((r) => getRowState(r).selected),
    [receives, getRowState]
  );

  const toggleAll = useCallback(() => {
    if (!receives) return;
    const newSelected = !allSelected;
    setRowStates((prev) => {
      const next = { ...prev };
      for (const r of receives) {
        next[r.receive_id] = {
          ...(next[r.receive_id] ?? defaultRowState(r)),
          selected: newSelected,
        };
      }
      return next;
    });
  }, [receives, allSelected, defaultRowState]);

  // Keyboard-wedge scan: select every unaccepted receive whose lot number
  // matches the scanned code (mapping/bin prefills still apply).
  const handleScan = useCallback(
    (code: string) => {
      const matches = matchScanCode(
        receives ?? [],
        code,
        (r) => r.lot_number
      );
      if (matches.length === 0) {
        toast.error(`No received line matches "${code}"`);
        return;
      }
      setRowStates((prev) => {
        const next = { ...prev };
        for (const r of matches) {
          next[r.receive_id] = {
            ...(next[r.receive_id] ?? defaultRowState(r)),
            selected: true,
          };
        }
        return next;
      });
      toast.success(
        `Selected ${matches.length} line${matches.length === 1 ? "" : "s"} for lot ${matches[0].lot_number}`
      );
    },
    [receives, defaultRowState]
  );

  // Validation: all selected rows must have an inventory_item_id
  const canSubmit = useMemo(() => {
    return (
      selectedReceives.length > 0 &&
      selectedReceives.every((r) => getRowState(r).inventory_item_id)
    );
  }, [selectedReceives, getRowState]);

  // Accept write path (lot creation + bin placement + invalidation)
  const acceptMutation = usePoAcceptMutation({
    selectedReceives,
    getRowState,
    binNameById,
    onAccepted: () => {
      setRowStates({});
      onClose();
    },
  });

  const isLoading = receivesLoading || itemsLoading || binsLoading;

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
            must be mapped to an inventory item; mappings and bins are
            prefilled from the last acceptance of the same catalog item.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : receives && receives.length > 0 ? (
          <div className="space-y-4">
            {/* Keyboard-wedge scan: scanners type the lot number + Enter */}
            <ScanInput
              onScan={handleScan}
              placeholder="Scan or type a lot number to select…"
              ariaLabel="Scan lot number"
            />
            <POAcceptReceiveGrid
              receives={receives}
              getRowState={getRowState}
              updateRow={updateRow}
              allSelected={allSelected}
              toggleAll={toggleAll}
              itemOptions={itemOptions}
              binOptions={binOptions}
              itemUnitById={itemUnitById}
              isMobile={isMobile}
              isTouch={isTouch}
            />
          </div>
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
          <FormActions
            submitLabel={`Accept Selected (${selectedReceives.length})`}
            loadingLabel="Processing..."
            submitIcon={<PackageCheck className="h-4 w-4 mr-2" />}
            isLoading={acceptMutation.isPending}
            submitDisabled={!canSubmit}
            onCancel={onClose}
            onSubmit={() => acceptMutation.mutate()}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
