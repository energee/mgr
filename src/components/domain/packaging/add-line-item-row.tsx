"use client";

/**
 * AddLineItemRow — batch-first quick-add table row for packaging session
 * line items.
 *
 * The batch combobox comes first and lists every packagable batch whose
 * recipe has a brand (usePackagableBatches); picking a batch auto-derives
 * the required brand_id. Brand-only entry remains available as a fallback
 * for batchless lines — the brand combobox is shown whenever no batch is
 * selected, and manually changing the brand clears any selected batch.
 *
 * Selecting a format (or batch) also prefills the planned quantity with
 * floor(batch volume ÷ per-unit fill volume) as an editable suggestion;
 * it only ever replaces an empty value or the previous suggestion, never
 * a quantity the user typed.
 *
 * Used by PackagingDayView and SessionLineItemsEditor (replaces the
 * brand-first row formerly in packaging-shared.tsx).
 */

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/universal/status-badge";
import { batchEntity } from "@/entities/batch";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  Combobox,
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import { AddLineButton } from "@/components/domain/shared/line-items-editor";
import {
  usePackagableBatches,
  useSellingFormatFillVolumes,
  suggestPlannedQuantity,
} from "@/hooks/use-packaging";
import { useBrands, usePackagingFormats } from "@/hooks/use-catalog";
import { createNameFilter } from "@/lib/combobox-filter";
import { UnitDisplay } from "@/components/ui/unit-input";
import { parseIntOrNull } from "@/lib/format";
import { FormatCell } from "./packaging-shared";
import type { NewItemState } from "@/hooks/use-session-line-items";

type AddLineItemRowProps = {
  newItem: NewItemState;
  onChange: (item: NewItemState) => void;
  onAdd: () => void;
  isPending: boolean;
  /** Whether to render an extra empty cell for the Variance column (PackagingDayView). */
  showVarianceCell?: boolean;
};

/**
 * Editable table row for adding a new line item. Renders batch combobox
 * (primary — derives brand), brand combobox (fallback for batchless lines),
 * format/keg-owner cell, and planned/actual quantity inputs.
 */
export function AddLineItemRow({
  newItem,
  onChange,
  onAdd,
  isPending,
  showVarianceCell = false,
}: AddLineItemRowProps) {
  const { data: batches, isLoading: batchesLoading } = usePackagableBatches();
  const { data: brands } = useBrands();
  const { data: packagingFormats } = usePackagingFormats();
  const fillVolumes = useSellingFormatFillVolumes();

  // Last auto-suggested quantity; lets a batch/format switch replace the
  // suggestion — never a value the user typed.
  const [lastSuggestion, setLastSuggestion] = useState<number | null>(null);

  const selectedBatch = useMemo(
    () => batches?.find((b) => b.id === newItem.batch_id),
    [batches, newItem.batch_id]
  );

  // Combobox filtering/labels match on "BATCH-001 — Brand" composite names.
  const batchFilterItems = useMemo(
    () =>
      batches?.map((b) => ({
        id: b.id,
        name: `${b.batch_code} — ${b.brand_name ?? ""}`,
      })),
    [batches]
  );
  const batchFilter = useMemo(
    () => createNameFilter(batchFilterItems),
    [batchFilterItems]
  );
  const brandFilter = useMemo(() => createNameFilter(brands), [brands]);

  /**
   * Prefill the planned quantity when the suggestion inputs (batch volume,
   * format fill volume) change. Only replaces an empty value or the previous
   * suggestion.
   */
  const applySuggestion = (
    item: NewItemState,
    batchVolumeBbl: number | null | undefined,
    formatId: string
  ): NewItemState => {
    const suggestion = suggestPlannedQuantity(
      batchVolumeBbl,
      formatId ? (fillVolumes.get(formatId) ?? null) : null
    );
    setLastSuggestion(suggestion);
    if (item.planned_quantity == null || item.planned_quantity === lastSuggestion) {
      return { ...item, planned_quantity: suggestion };
    }
    return item;
  };

  const handleBatchChange = (batchId: string) => {
    const batch = batches?.find((b) => b.id === batchId);
    // Clearing the batch keeps the brand so it can serve as a batchless line.
    const next: NewItemState = batch
      ? { ...newItem, batch_id: batch.id, brand_id: batch.brand_id }
      : { ...newItem, batch_id: "" };
    onChange(applySuggestion(next, batch?.volume_bbl, next.format_id));
  };

  const handleFormatChange = (formatId: string) => {
    const format = packagingFormats?.find((f) => f.id === formatId);
    const next: NewItemState = {
      ...newItem,
      format_id: formatId,
      keg_owner_id:
        format?.container_type === "keg" ? newItem.keg_owner_id : "",
    };
    onChange(applySuggestion(next, selectedBatch?.volume_bbl, formatId));
  };

  return (
    <TableRow>
      {/* Batch (primary — picking one derives the brand) */}
      <TableCell>
        <Combobox
          value={newItem.batch_id}
          onValueChange={handleBatchChange}
          onFilter={batchFilter}
        >
          <ComboboxAnchor className="h-8 max-md:h-11">
            <ComboboxInput className="h-8 max-md:h-11" placeholder="Select batch" />
            <ComboboxTrigger />
          </ComboboxAnchor>
          <ComboboxContent>
            <ComboboxEmpty>
              {batchesLoading ? "Loading..." : "No batches found"}
            </ComboboxEmpty>
            {batches?.map((batch) => (
              <ComboboxItem
                key={batch.id}
                value={batch.id}
                label={batch.batch_code}
              >
                <span className="flex items-center gap-2">
                  {batch.batch_code}
                  <span className="text-xs text-muted-foreground">
                    {batch.brand_name}
                  </span>
                  <StatusBadge
                    status={batch.status}
                    config={batchEntity.stateMachine?.stateDisplay}
                  />
                  {batch.volume_bbl != null && (
                    <span className="text-xs text-muted-foreground">
                      <UnitDisplay
                        value={batch.volume_bbl}
                        unitType="volume"
                      />
                    </span>
                  )}
                </span>
              </ComboboxItem>
            ))}
          </ComboboxContent>
        </Combobox>
      </TableCell>

      {/* Brand — derived from the batch, or picked directly for batchless lines */}
      <TableCell>
        {selectedBatch ? (
          <span className="text-sm font-medium">
            {selectedBatch.brand_name ?? "—"}
          </span>
        ) : (
          <Combobox
            value={newItem.brand_id}
            onValueChange={(v) =>
              // A manual brand pick is the batchless fallback; ensure no
              // stale batch contradicts it.
              onChange({ ...newItem, brand_id: v, batch_id: "" })
            }
            onFilter={brandFilter}
          >
            <ComboboxAnchor className="h-8 max-md:h-11">
              <ComboboxInput className="h-8 max-md:h-11" placeholder="Select brand" />
              <ComboboxTrigger />
            </ComboboxAnchor>
            <ComboboxContent>
              <ComboboxEmpty>No brands found</ComboboxEmpty>
              {brands?.map((brand) => (
                <ComboboxItem
                  key={brand.id}
                  value={brand.id}
                  label={brand.name}
                >
                  {brand.name}
                </ComboboxItem>
              ))}
            </ComboboxContent>
          </Combobox>
        )}
      </TableCell>

      {/* Format + keg owner */}
      <TableCell>
        <FormatCell
          formatId={newItem.format_id}
          onFormatChange={handleFormatChange}
          kegOwnerId={newItem.keg_owner_id}
          onKegOwnerChange={(v) => onChange({ ...newItem, keg_owner_id: v })}
        />
      </TableCell>

      {/* Planned */}
      <TableCell>
        <Input
          type="number"
          min={0}
          value={newItem.planned_quantity ?? ""}
          onChange={(e) =>
            onChange({
              ...newItem,
              planned_quantity: parseIntOrNull(e.target.value),
            })
          }
          className="h-8 w-full max-md:h-11"
          placeholder="Planned"
        />
      </TableCell>

      {/* Actual */}
      <TableCell className={showVarianceCell ? "bg-amber-50" : undefined}>
        <Input
          type="number"
          min={0}
          value={newItem.actual_quantity ?? ""}
          onChange={(e) =>
            onChange({
              ...newItem,
              actual_quantity: parseIntOrNull(e.target.value),
            })
          }
          className="h-8 w-full max-md:h-11"
          placeholder="Actual"
        />
      </TableCell>

      {/* Variance placeholder (PackagingDayView only) */}
      {showVarianceCell && <TableCell />}

      {/* Add button */}
      <TableCell>
        <AddLineButton
          label="Add line item"
          onClick={onAdd}
          isPending={isPending}
          className="h-8 w-8 max-md:h-11 max-md:w-full"
        />
      </TableCell>
    </TableRow>
  );
}
