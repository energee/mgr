"use client";

/**
 * Shared UI components for packaging session views.
 *
 * BatchCell — batch selector (editable or read-only) for line item rows.
 * FormatCell — format combobox with conditional keg-owner sub-selector.
 *
 * Used by PackagingDayView, SessionLineItemsEditor, and AddLineItemRow
 * (the batch-first quick-add row in add-line-item-row.tsx).
 */

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/universal/status-badge";
import { batchEntity } from "@/entities/batch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ComboboxField,
  ComboboxItem,
} from "@/components/ui/combobox";
import { useBatchesForBrand, useKegFormatIds } from "@/hooks/use-packaging";
import { usePackagingFormats, useKegOwners, formatVolumeLabel } from "@/hooks/use-catalog";
import { createNameFilter } from "@/lib/combobox-filter";
import { UnitDisplay } from "@/components/ui/unit-input";

// =============================================================================
// BatchCell — batch selector for line item rows
// =============================================================================

type BatchCellProps = {
  brandId: string;
  currentBatchId: string;
  /**
   * Batch code of the currently-selected batch, if known by the caller.
   * `useBatchesForBrand` only returns active batches (planned…packaging), so a
   * line item pointing at an already-packaged/completed batch would otherwise
   * fall out of the options and the Select would render blank. Passing the
   * known code lets us inject a fallback option so the selection still shows.
   */
  currentBatchCode?: string | null;
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
  currentBatchCode,
  onSelect,
  readOnly = false,
}: BatchCellProps) {
  const { data: batches, isLoading } = useBatchesForBrand(brandId || null);

  if (readOnly) {
    const batch = batches?.find((b) => b.id === currentBatchId);
    return <span>{batch?.batch_code ?? currentBatchCode ?? "—"}</span>;
  }

  // The selected batch may be excluded from the active-status option list
  // (e.g. already packaged); inject it so the Select can display it.
  const selectedInOptions = batches?.some((b) => b.id === currentBatchId);
  const showFallback = !!currentBatchId && !isLoading && !selectedInOptions;

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
        {showFallback && (
          <SelectItem value={currentBatchId}>
            {currentBatchCode ?? currentBatchId}
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

  const formatLabel = formatId
    ? (packagingFormats?.find((f) => f.id === formatId)?.name ?? "")
    : "";
  const ownerLabel = kegOwnerId
    ? (kegOwners?.find((o) => o.id === kegOwnerId)?.name ?? "")
    : "";

  return (
    <div className="space-y-1">
      <ComboboxField
        value={formatId}
        selectedLabel={formatLabel}
        onValueChange={onFormatChange}
        onFilter={formatFilter}
        placeholder="Select format"
        emptyText="No formats found"
        anchorClassName="h-8"
        inputClassName="h-8"
      >
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
      </ComboboxField>
      {isKeg && (
        <ComboboxField
          value={kegOwnerId}
          selectedLabel={ownerLabel}
          onValueChange={onKegOwnerChange}
          onFilter={ownerFilter}
          placeholder="Keg owner (optional)"
          emptyText="No owners found"
          anchorClassName="h-8"
          inputClassName="h-8"
        >
          {kegOwners?.map((o) => (
            <ComboboxItem key={o.id} value={o.id} label={o.name}>
              {o.name}
            </ComboboxItem>
          ))}
        </ComboboxField>
      )}
    </div>
  );
}
