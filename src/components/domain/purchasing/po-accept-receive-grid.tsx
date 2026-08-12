"use client";

/**
 * PO Accept receive grid — the bin-placement/selection surface of the
 * "Accept into Inventory" dialog (po-accept-inventory-dialog.tsx).
 *
 * Renders the unaccepted receives as a 7-column table on desktop, or as
 * stacked cards when `isMobile`; when `isTouch`, checkboxes and the per-row
 * comboboxes get enlarged hit areas. Each row exposes an inventory-item
 * picker (required) and a storage-bin picker (optional), both rendered with
 * the table-cell-sized CellCombobox.
 *
 * Purely presentational: all row state lives in the parent dialog and flows
 * in via getRowState/updateRow. `isMobile`/`isTouch` are props rather than
 * local useIsMobile/useIsTouch calls so the grid holds no matchMedia
 * subscription of its own — it can be rendered at either breakpoint from a
 * test without stubbing the media query, and the dialog stays the single
 * place the layout mode is decided.
 */

import { useId, useMemo } from "react";
import type {
  UnacceptedReceive,
  RowState,
} from "@/domain/purchasing/po-accept-utils";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ComboboxField, ComboboxItem } from "@/components/ui/combobox";
import { AlertTriangle } from "lucide-react";
import { unitsEquivalent } from "@/domain/inventory-units";
import { cn } from "@/lib/utils";

type POAcceptReceiveGridProps = {
  receives: UnacceptedReceive[];
  getRowState: (r: UnacceptedReceive) => RowState;
  updateRow: (r: UnacceptedReceive, updates: Partial<RowState>) => void;
  allSelected: boolean;
  toggleAll: () => void;
  itemOptions: { value: string; label: string }[];
  binOptions: { value: string; label: string }[];
  /** Inventory-item tracking unit by item id, for the unit-mismatch note */
  itemUnitById: Map<string, string>;
  /** Below the md breakpoint: stacked cards instead of the table */
  isMobile: boolean;
  /** Coarse pointer: enlarged checkbox / combobox hit areas */
  isTouch: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function POAcceptReceiveGrid({
  receives,
  getRowState,
  updateRow,
  allSelected,
  toggleAll,
  itemOptions,
  binOptions,
  itemUnitById,
  isMobile,
  isTouch,
}: POAcceptReceiveGridProps) {
  // Unique id base for mobile-card checkbox/label association
  const selectAllId = useId();

  if (isMobile) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 px-1">
          <Checkbox
            id={selectAllId}
            className="size-5"
            checked={allSelected}
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
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              className={cn(isTouch && "size-5")}
              checked={allSelected}
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
 * Table-cell-sized searchable picker for table cells. Wraps the shared
 * {@link ComboboxField} primitive, which owns the "control inputValue from
 * the selected label" fix (the diceui Combobox doesn't sync its display text
 * when `value` changes programmatically — which happens here when rows are
 * prefilled from prior mappings).
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
    <ComboboxField
      value={value || undefined}
      selectedLabel={resolvedLabel}
      onValueChange={(v) => onChange(v || "")}
      onFilter={onFilter}
      placeholder={placeholder}
      emptyText={emptyText}
      anchorClassName={tall ? "h-10" : "h-8"}
      inputClassName={tall ? "h-10" : "h-8"}
      inputProps={{ "aria-label": ariaLabel }}
      onClear={clearable ? () => onChange("") : undefined}
    >
      {options.map((option) => (
        <ComboboxItem
          key={option.value}
          value={option.value}
          label={option.label}
        >
          {option.label}
        </ComboboxItem>
      ))}
    </ComboboxField>
  );
}
