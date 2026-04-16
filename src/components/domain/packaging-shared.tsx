"use client";

/**
 * Shared UI components for packaging session views.
 *
 * BatchCell — batch selector (editable or read-only) for line item rows.
 * FormatCell — format combobox with conditional keg-owner sub-selector.
 * AddLineItemRow — quick-add table row for new line items.
 *
 * Used by PackagingDayView and SessionLineItemsEditor.
 */

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/universal/status-badge";
import { batchEntity } from "@/entities/batch";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Combobox,
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import { Plus, Loader2 } from "lucide-react";
import { useBatchesForBrand, useKegFormatIds } from "@/hooks/use-packaging";
import { useBrands, usePackagingFormats, useKegOwners, formatVolumeLabel } from "@/hooks/use-catalog";
import { createNameFilter } from "@/lib/combobox-filter";
import { UnitDisplay } from "@/components/ui/unit-input";
import { parseIntOrNull } from "@/lib/format";
import type { NewItemState } from "@/hooks/use-session-line-items";

// =============================================================================
// BatchCell — batch selector for line item rows
// =============================================================================

type BatchCellProps = {
  brandId: string;
  currentBatchId: string;
  onSelect: (batchId: string) => void;
  readOnly?: boolean;
};

/**
 * Inline batch selector. Fetches batches for the given brand and renders
 * either a read-only label or a `<Select>` dropdown.
 */
export function BatchCell({
  brandId,
  currentBatchId,
  onSelect,
  readOnly = false,
}: BatchCellProps) {
  const { data: batches, isLoading } = useBatchesForBrand(brandId || null);

  if (readOnly) {
    const batch = batches?.find((b) => b.id === currentBatchId);
    return <span>{batch?.batch_code ?? "—"}</span>;
  }

  return (
    <Select value={currentBatchId} onValueChange={onSelect}>
      <SelectTrigger className="h-8">
        <SelectValue placeholder="Select batch" />
      </SelectTrigger>
      <SelectContent>
        {isLoading && (
          <SelectItem value="_loading" disabled>
            Loading...
          </SelectItem>
        )}
        {batches?.map((batch) => (
          <SelectItem key={batch.id} value={batch.id}>
            <span className="flex items-center gap-2">
              {batch.batch_code}
              <StatusBadge
                status={batch.status}
                config={batchEntity.stateMachine?.stateDisplay}
              />
              {batch.volume_bbl != null && (
                <span className="text-xs text-muted-foreground">
                  <UnitDisplay value={batch.volume_bbl} unitType="volume" />
                </span>
              )}
            </span>
          </SelectItem>
        ))}
        {!isLoading && (!batches || batches.length === 0) && (
          <SelectItem value="_none" disabled>
            No batches available
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}

// =============================================================================
// FormatCell — format combobox + conditional keg owner
// =============================================================================

type FormatCellProps = {
  formatId: string;
  onFormatChange: (formatId: string) => void;
  kegOwnerId: string;
  onKegOwnerChange: (ownerId: string) => void;
};

/**
 * Selling format combobox. Fetches catalog data internally (React Query
 * deduplicates across call sites). When the selected format is a keg,
 * renders a second combobox for keg-owner selection underneath.
 */
export function FormatCell({
  formatId,
  onFormatChange,
  kegOwnerId,
  onKegOwnerChange,
}: FormatCellProps) {
  const { data: packagingFormats } = usePackagingFormats();
  const { data: kegOwners } = useKegOwners();
  const kegFormatIds = useKegFormatIds();
  const isKeg = !!formatId && kegFormatIds.has(formatId);

  const formatFilter = useMemo(() => createNameFilter(packagingFormats), [packagingFormats]);
  const ownerFilter = useMemo(() => createNameFilter(kegOwners), [kegOwners]);

  return (
    <div className="space-y-1">
      <Combobox
        value={formatId}
        onValueChange={onFormatChange}
        onFilter={formatFilter}
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
                  <span className="text-xs text-muted-foreground">
                    {formatVolumeLabel(f)}
                  </span>
                )}
                {f.container_type === "keg" && (
                  <Badge variant="outline" className="text-xs">
                    keg
                  </Badge>
                )}
              </span>
            </ComboboxItem>
          ))}
        </ComboboxContent>
      </Combobox>
      {isKeg && (
        <Combobox
          value={kegOwnerId}
          onValueChange={onKegOwnerChange}
          onFilter={ownerFilter}
        >
          <ComboboxAnchor className="h-8">
            <ComboboxInput
              className="h-8"
              placeholder="Keg owner (optional)"
            />
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
  );
}

// =============================================================================
// AddLineItemRow — quick-add table row for new line items
// =============================================================================

type AddLineItemRowProps = {
  newItem: NewItemState;
  onChange: (item: NewItemState) => void;
  onAdd: () => void;
  isPending: boolean;
  /** Whether to render an extra empty cell for the Variance column (PackagingDayView). */
  showVarianceCell?: boolean;
};

/**
 * Editable table row for adding a new line item. Renders brand combobox,
 * batch selector, format/keg-owner cell, and planned/actual quantity inputs.
 */
export function AddLineItemRow({
  newItem,
  onChange,
  onAdd,
  isPending,
  showVarianceCell = false,
}: AddLineItemRowProps) {
  const { data: brands } = useBrands();
  const { data: packagingFormats } = usePackagingFormats();
  const brandFilter = useMemo(() => createNameFilter(brands), [brands]);

  return (
    <TableRow>
      {/* Brand */}
      <TableCell>
        <Combobox
          value={newItem.brand_id}
          onValueChange={(v) =>
            onChange({ ...newItem, brand_id: v, batch_id: "" })
          }
          onFilter={brandFilter}
        >
          <ComboboxAnchor className="h-8">
            <ComboboxInput className="h-8" placeholder="Select brand" />
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
      </TableCell>

      {/* Batch */}
      <TableCell>
        <BatchCell
          brandId={newItem.brand_id}
          currentBatchId={newItem.batch_id}
          onSelect={(value) => onChange({ ...newItem, batch_id: value })}
        />
      </TableCell>

      {/* Format + keg owner */}
      <TableCell>
        <FormatCell
          formatId={newItem.format_id}
          onFormatChange={(v) => {
            const format = packagingFormats?.find((f) => f.id === v);
            onChange({
              ...newItem,
              format_id: v,
              keg_owner_id:
                format?.container_type === "keg" ? newItem.keg_owner_id : "",
            });
          }}
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
          className="h-8 w-full"
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
          className="h-8 w-full"
          placeholder="Actual"
        />
      </TableCell>

      {/* Variance placeholder (PackagingDayView only) */}
      {showVarianceCell && <TableCell />}

      {/* Add button */}
      <TableCell>
        <Button
          size="icon"
          aria-label="Add line item"
          className="h-8 w-8"
          onClick={onAdd}
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
        </Button>
      </TableCell>
    </TableRow>
  );
}
