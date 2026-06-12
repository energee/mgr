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
 * for the same mapping. Bin placement writes a structured
 * bin_inventory_items row (lot ↔ bin ↔ quantity); the legacy free-text
 * inventory_lots.location column is only mirrored with the canonical bin
 * name so existing location display/search keeps working.
 *
 * The received unit is copied verbatim onto the created lot, so when it
 * differs from the selected inventory item's unit (alias-tolerant compare
 * via unitsEquivalent) a non-blocking warning is shown — a lot stored in
 * "sack" can never reconcile with demand planned in the item's unit.
 *
 * Hands-on receiving support (audit F-38): a keyboard-wedge scan field
 * (shared/scan-input.tsx) matches scanned lot numbers against the
 * unaccepted receives and selects them; below the md breakpoint
 * (useIsMobile) the 7-column table is replaced by stacked cards, and on
 * coarse-pointer devices (useIsTouch) checkboxes and the per-row
 * comboboxes get enlarged hit areas.
 */

import { useState, useCallback, useMemo, useEffect, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicRpc } from "@/services/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
  Combobox,
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Loader2,
  PackageCheck,
  AlertCircle,
  AlertTriangle,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { resolveCatalogNames } from "@/entities/po-line-item";
import { unitsEquivalent } from "@/domain/inventory-units";
import { poReceiveKeys, entityKeys, binKeys } from "@/lib/query-keys";
import { log } from "@/lib/client-logger";
import { cn } from "@/lib/utils";
import { useIsMobile, useIsTouch } from "@/hooks/use-mobile";
import { ScanInput } from "@/components/domain/shared/scan-input";
import { matchScanCode } from "@/components/domain/shared/scan-match";
import {
  buildMappingDefaults,
  buildBinPlacements,
  catalogKey,
  type PriorLotRow,
} from "./po-accept-utils";

// =============================================================================
// Types
// =============================================================================

type UnacceptedReceive = {
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

type RowState = {
  selected: boolean;
  inventory_item_id: string;
  /** Storage bin (bins.id); writes a bin_inventory_items row on accept */
  bin_id: string;
}

type POAcceptInventoryDialogProps = {
  poId: string;
  open: boolean;
  onClose: () => void;
}

/** Error message used when lots were created but bin placement failed */
const PLACEMENT_FAILED_MESSAGE =
  "Items were accepted, but bin placement failed — assign bins from the bin pages.";

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
  const isMobile = useIsMobile();
  const isTouch = useIsTouch();
  // Unique id base for mobile-card checkbox/label association
  const selectAllId = useId();

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
      const { data, error } = await dynamicRpc(supabase, "get_unaccepted_po_receives", { p_po_id: poId });

      if (error) throw error;
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
      receives &&
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

  // Mutation: create inventory_lots, then structured bin placements
  const acceptMutation = useMutation({
    mutationFn: async () => {
      const lotsToInsert = selectedReceives.map((r) => {
        const state = getRowState(r);
        return {
          inventory_item_id: state.inventory_item_id,
          po_receive_id: r.receive_id,
          quantity: r.quantity,
          unit: r.unit,
          unit_cost: r.unit_price,
          lot_number: r.lot_number,
          expiration_date: r.expiration_date,
          received_date: r.received_date,
          // Legacy text column mirrors the canonical bin name so existing
          // location display/search keeps working; the structured placement
          // lives in bin_inventory_items (inserted below).
          location: state.bin_id
            ? binNameById.get(state.bin_id) ?? null
            : null,
        };
      });

      const { data: insertedLots, error } = await supabase
        .from("inventory_lots")
        .insert(lotsToInsert)
        .select("id, po_receive_id");

      if (error) throw error;

      // Structured lot↔bin placement rows (quantity = full lot quantity)
      const placementByReceiveId = new Map(
        selectedReceives.flatMap((r) => {
          const state = getRowState(r);
          return state.bin_id
            ? ([[r.receive_id, { bin_id: state.bin_id, quantity: r.quantity }]] as const)
            : [];
        })
      );
      const placements = buildBinPlacements(
        insertedLots ?? [],
        placementByReceiveId
      );
      if (placements.length > 0) {
        const { error: placementError } = await supabase
          .from("bin_inventory_items")
          .insert(placements);
        if (placementError) {
          // Lots are already accepted at this point — surface a precise
          // message instead of the generic failure toast.
          log.error("Bin placement insert error:", placementError);
          throw new Error(PLACEMENT_FAILED_MESSAGE);
        }
      }
    },
    onSuccess: () => {
      const count = selectedReceives.length;
      toast.success(
        `${count} item${count !== 1 ? "s" : ""} accepted into inventory`
      );
      setRowStates({});
      onClose();
    },
    onError: (error) => {
      log.error("Accept into inventory error:", error);
      toast.error(
        error instanceof Error && error.message === PLACEMENT_FAILED_MESSAGE
          ? PLACEMENT_FAILED_MESSAGE
          : "Failed to accept items into inventory"
      );
    },
    // Invalidate on settled (not just success): the lots insert may have
    // succeeded even when bin placement subsequently failed. The whole
    // po-receives namespace is invalidated so mapping defaults pick up
    // this acceptance as the newest mapping.
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: poReceiveKeys.all(),
      });
      queryClient.invalidateQueries({
        queryKey: entityKeys.all("inventory_lots"),
      });
      queryClient.invalidateQueries({ queryKey: binKeys.all() });
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
            {isMobile ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 px-1">
                  <Checkbox
                    id={selectAllId}
                    className="size-5"
                    checked={allSelected ?? false}
                    onCheckedChange={toggleAll}
                  />
                  <label
                    htmlFor={selectAllId}
                    className="text-sm text-muted-foreground"
                  >
                    Select all
                  </label>
                </div>
                {receives.map((r) => {
                  const state = getRowState(r);
                  const itemUnit = state.inventory_item_id
                    ? itemUnitById.get(state.inventory_item_id)
                    : undefined;
                  return (
                    <div
                      key={r.receive_id}
                      className={cn(
                        "space-y-3 rounded-lg border p-4",
                        state.selected && "border-primary/50 bg-primary/5"
                      )}
                    >
                      {/* Whole header is the (≥44px) selection target */}
                      <div className="flex items-start gap-3">
                        <Checkbox
                          id={`${selectAllId}-${r.receive_id}`}
                          className="mt-0.5 size-5"
                          checked={state.selected}
                          onCheckedChange={(checked) =>
                            updateRow(r, { selected: !!checked })
                          }
                        />
                        <label
                          htmlFor={`${selectAllId}-${r.receive_id}`}
                          className="min-w-0 flex-1"
                        >
                          <span className="block font-medium">
                            {r.catalog_name}
                          </span>
                          <span className="block text-sm text-muted-foreground">
                            {r.quantity} {r.unit}
                            {r.lot_number ? ` · Lot ${r.lot_number}` : ""}
                            {r.expiration_date
                              ? ` · Exp ${r.expiration_date}`
                              : ""}
                          </span>
                        </label>
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">
                          Inventory Item
                        </span>
                        <CellCombobox
                          value={state.inventory_item_id}
                          options={itemOptions}
                          onChange={(v) =>
                            updateRow(r, { inventory_item_id: v })
                          }
                          placeholder="Search items..."
                          emptyText="No items found"
                          ariaLabel={`Inventory item for ${r.catalog_name}`}
                          tall
                        />
                        <ReceivedUnitNote
                          itemUnit={itemUnit}
                          receivedUnit={r.unit}
                          quantity={r.quantity}
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">
                          Bin
                        </span>
                        <CellCombobox
                          value={state.bin_id}
                          options={binOptions}
                          onChange={(v) => updateRow(r, { bin_id: v })}
                          placeholder="Search bins..."
                          emptyText="No bins found"
                          ariaLabel={`Bin for ${r.catalog_name}`}
                          clearable
                          tall
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        className={cn(isTouch && "size-5")}
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
                    <TableHead className="min-w-[160px]">Bin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receives.map((r) => {
                    const state = getRowState(r);
                    const itemUnit = state.inventory_item_id
                      ? itemUnitById.get(state.inventory_item_id)
                      : undefined;

                    return (
                      <TableRow key={r.receive_id}>
                        <TableCell>
                          <Checkbox
                            className={cn(isTouch && "size-5")}
                            checked={state.selected}
                            onCheckedChange={(checked) =>
                              updateRow(r, {
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
                          <CellCombobox
                            value={state.inventory_item_id}
                            options={itemOptions}
                            onChange={(v) =>
                              updateRow(r, { inventory_item_id: v })
                            }
                            placeholder="Search items..."
                            emptyText="No items found"
                            ariaLabel={`Inventory item for ${r.catalog_name}`}
                            tall={isTouch}
                          />
                          <ReceivedUnitNote
                            itemUnit={itemUnit}
                            receivedUnit={r.unit}
                            quantity={r.quantity}
                          />
                        </TableCell>
                        <TableCell>
                          <CellCombobox
                            value={state.bin_id}
                            options={binOptions}
                            onChange={(v) => updateRow(r, { bin_id: v })}
                            placeholder="Search bins..."
                            emptyText="No bins found"
                            ariaLabel={`Bin for ${r.catalog_name}`}
                            clearable
                            tall={isTouch}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
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

// =============================================================================
// ReceivedUnitNote — unit context under the inventory-item picker
// =============================================================================

/**
 * Non-blocking note under the inventory-item picker, shared by the table
 * and mobile-card layouts. Shows the selected item's tracking unit,
 * escalating to a warning when it differs from the received unit
 * (alias-tolerant compare via unitsEquivalent): the lot is created in the
 * received unit, so quantities won't reconcile with the item's unit.
 */
function ReceivedUnitNote({
  itemUnit,
  receivedUnit,
  quantity,
}: {
  itemUnit: string | undefined;
  receivedUnit: string;
  quantity: number;
}) {
  if (!itemUnit) return null;
  const unitMismatch =
    !!receivedUnit && !unitsEquivalent(itemUnit, receivedUnit);
  return (
    <p
      className={
        unitMismatch
          ? "mt-1 flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400"
          : "mt-1 text-xs text-muted-foreground"
      }
    >
      {unitMismatch && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
      {unitMismatch
        ? `Received in ${receivedUnit}, but this item is tracked in ${itemUnit} — the lot will be stored as ${quantity} ${receivedUnit} and won't reconcile with ${itemUnit} planning.`
        : `Item tracked in ${itemUnit}`}
    </p>
  );
}

// =============================================================================
// CellCombobox — compact searchable picker for table cells
// =============================================================================

/**
 * Table-cell-sized searchable Combobox. Like the universal framework's
 * RelationCombobox (field-input.tsx), it manages `inputValue` locally
 * because the diceui Combobox doesn't sync its display text when `value`
 * changes programmatically — which happens here when rows are prefilled
 * from prior mappings.
 */
function CellCombobox({
  value,
  options,
  onChange,
  placeholder,
  emptyText,
  ariaLabel,
  clearable = false,
  tall = false,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  placeholder: string;
  emptyText: string;
  ariaLabel: string;
  /** Show an X button to clear the selection (for optional pickers) */
  clearable?: boolean;
  /** Larger hit area (h-10) for touch devices / mobile cards */
  tall?: boolean;
}) {
  const labelByValue = useMemo(
    () => new Map(options.map((o) => [o.value, o.label])),
    [options]
  );

  const resolvedLabel = value ? (labelByValue.get(value) ?? "") : "";
  const [inputText, setInputText] = useState(resolvedLabel);

  // Sync display text when value or options change (e.g. prefill applied,
  // options finish loading)
  useEffect(() => {
    setInputText(resolvedLabel);
  }, [resolvedLabel]);

  const onFilter = useMemo(
    () => (values: string[], inputValue: string) => {
      const q = inputValue.trim().toLowerCase();
      if (!q) return values;
      return values.filter((v) =>
        (labelByValue.get(v) ?? "").toLowerCase().includes(q)
      );
    },
    [labelByValue]
  );

  return (
    <Combobox
      value={value || undefined}
      inputValue={inputText}
      onInputValueChange={setInputText}
      onValueChange={(v) => onChange(v || "")}
      onFilter={onFilter}
    >
      <ComboboxAnchor className={tall ? "h-10" : "h-8"}>
        <ComboboxInput
          className={tall ? "h-10" : "h-8"}
          placeholder={placeholder}
          aria-label={ariaLabel}
        />
        {clearable && !!value && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              setInputText("");
            }}
            className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label="Clear selection"
          >
            <X className="size-3.5" />
          </button>
        )}
        <ComboboxTrigger />
      </ComboboxAnchor>
      <ComboboxContent>
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        {options.map((option) => (
          <ComboboxItem
            key={option.value}
            value={option.value}
            label={option.label}
          >
            {option.label}
          </ComboboxItem>
        ))}
      </ComboboxContent>
    </Combobox>
  );
}
