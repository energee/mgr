"use client";

/**
 * GrainBillEditor - Recipe Grain Bill Management Component
 *
 * Manages recipe malts in junction table format with searchable malt selector,
 * inline weight editing, automatic percentage calculation, and drag-to-reorder.
 */

import { useMemo } from "react";
import { useCatalog } from "@/hooks/use-catalog";
import {
  TableCell,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import {
  SortableRows,
  SortableHandleCell,
  RemoveRowCell,
  SortableDragPreview,
  useSortableRows,
} from "@/components/ui/sortable-rows";
import { CatalogAddPopover } from "@/components/ui/catalog-add-popover";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useResolvedUnitPreferences } from "@/hooks/use-unit-preferences";
import { formatWeight } from "@/domain/units";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { catalogKeys } from "@/lib/query-keys";

export type GrainBillItem = {
  id?: string;
  malt_id: string;
  weight_lbs: number;
  position: number;
  /** Joined data (read-only) */
  malt?: {
    id: string;
    name: string;
    maltster: string | null;
    type: string;
    color_lovibond: number | null;
    potential_ppg: number | null;
    bag_weight_lbs: number | null;
  };
}

type MaltCatalogItem = {
  id: string;
  name: string;
  maltster: string | null;
  type: string;
  color_lovibond: number | null;
  potential_ppg: number | null;
  bag_weight_lbs: number | null;
}

/** Malt type display labels for the selector grouping */
/** Domain constants: malt category labels (not entity status -- no stateMachine applies). */
const MALT_TYPE_LABELS: Record<string, string> = {
  base: "Base Malts",
  specialty: "Specialty Malts",
  roasted: "Roasted Malts",
  adjunct: "Adjuncts",
  other: "Other",
};

type GrainBillEditorProps = {
  items: GrainBillItem[];
  onChange: (items: GrainBillItem[]) => void;
  disabled?: boolean;
}

export function GrainBillEditor({
  items,
  onChange,
  disabled = false,
}: GrainBillEditorProps) {
  const weightUnit = useResolvedUnitPreferences().weight_unit;
  const rows = useSortableRows({ items, onChange });

  const { data: maltCatalog = [], isLoading: loadingMalts } = useCatalog<MaltCatalogItem>(
    catalogKeys.malts(),
    "malts",
    "id, name, maltster, type, color_lovibond, potential_ppg, bag_weight_lbs",
    ["type", "name"]
  );

  const totalWeight = useMemo(
    () => items.reduce((sum, item) => sum + (item.weight_lbs || 0), 0),
    [items]
  );

  function getPercentage(weight: number): number {
    if (totalWeight === 0) return 0;
    return (weight / totalWeight) * 100;
  }

  /** Adding a malt already in the bill is a no-op (the popover still closes). */
  function handleAddMalt(malt: MaltCatalogItem) {
    if (items.some((item) => item.malt_id === malt.id)) return;
    rows.append({ id: crypto.randomUUID(), malt_id: malt.id, weight_lbs: 0, malt });
  }

  const addedMaltIds = useMemo(
    () => new Set(items.map((item) => item.malt_id)),
    [items]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <CatalogAddPopover
          catalog={maltCatalog}
          excludeIds={addedMaltIds}
          getGroup={(malt) => malt.type}
          groupLabels={MALT_TYPE_LABELS}
          getSearchValue={(malt) => `${malt.name} ${malt.maltster || ""}`}
          getDetail={(malt) => (
            <span className="text-xs text-muted-foreground">
              {malt.maltster}
              {malt.color_lovibond && ` • ${malt.color_lovibond}°L`}
              {malt.potential_ppg && ` • ${malt.potential_ppg} PPG`}
            </span>
          )}
          onSelect={handleAddMalt}
          triggerLabel="Add Malt"
          searchPlaceholder="Search malts..."
          emptyMessage="No malts found."
          disabled={disabled || loadingMalts}
        />
      </div>

      <SortableRows
        items={items}
        onReorder={rows.reorder}
        disabled={disabled}
        columns={[
          { className: "w-8" },
          { label: "Malt" },
          { label: "Weight (lbs)", className: "w-24 text-right" },
          { label: "Bags", className: "w-16 text-right" },
          { label: "%", className: "w-20 text-right" },
          { label: "°L", className: "w-20 text-right" },
          { className: "w-16" },
        ]}
        empty={
          <div className="border rounded-md p-8 text-center text-muted-foreground">
            <p>No malts added yet.</p>
            <p className="text-sm mt-1">Click &quot;Add Malt&quot; to build your grain bill.</p>
          </div>
        }
        overlay={(item) => (
          <SortableDragPreview
            title={
              (item?.malt || maltCatalog.find((m) => m.id === item?.malt_id))?.name || "Unknown"
            }
            subtitle={item?.weight_lbs ? `${item.weight_lbs} lbs` : undefined}
          />
        )}
        footer={
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2} className="font-medium">
                Total
              </TableCell>
              <TableCell className="text-right font-medium">
                {formatWeight(totalWeight, weightUnit)}
              </TableCell>
              <TableCell></TableCell>
              <TableCell className="text-right font-medium">100%</TableCell>
              <TableCell colSpan={2}></TableCell>
            </TableRow>
          </TableFooter>
        }
      >
        {(item, index) => {
          const malt = item.malt || maltCatalog.find((m) => m.id === item.malt_id);
          const percentage = getPercentage(item.weight_lbs);

          return (
            <TableRow>
              <SortableHandleCell />
              <TableCell>
                <div className="flex items-center gap-2">
                  <div>
                    <div className="font-medium">{malt?.name || "Unknown"}</div>
                    <div className="text-xs text-muted-foreground">{malt?.maltster}</div>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {malt?.type}
                  </Badge>
                </div>
              </TableCell>
              <TableCell className="text-right">
                <Input
                  type="number"
                  step="0.25"
                  min="0"
                  value={item.weight_lbs || ""}
                  onChange={(e) =>
                    rows.updateField(index, "weight_lbs", parseFloat(e.target.value) || 0)
                  }
                  disabled={disabled}
                  className="w-20 text-right ml-auto"
                />
              </TableCell>
              <TableCell className="text-right text-muted-foreground tabular-nums">
                {malt?.bag_weight_lbs
                  ? (item.weight_lbs / malt.bag_weight_lbs).toFixed(1)
                  : "—"}
              </TableCell>
              <TableCell className="text-right">
                <span
                  className={cn("tabular-nums", percentage >= 70 && "font-semibold text-primary")}
                >
                  {percentage.toFixed(1)}%
                </span>
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {malt?.color_lovibond?.toFixed(1) || "—"}
              </TableCell>
              <RemoveRowCell onClick={() => rows.remove(index)} disabled={disabled} />
            </TableRow>
          );
        }}
      </SortableRows>

      {items.length > 0 && (
        <GrainBillWarnings items={items} totalWeight={totalWeight} />
      )}
    </div>
  );
}

function GrainBillWarnings({
  items,
  totalWeight,
}: {
  items: GrainBillItem[];
  totalWeight: number;
}) {
  const warnings: string[] = [];

  const baseMalts = items.filter((item) => item.malt?.type === "base");
  const baseWeight = baseMalts.reduce((sum, item) => sum + (item.weight_lbs || 0), 0);
  const basePercent = totalWeight > 0 ? (baseWeight / totalWeight) * 100 : 0;

  if (totalWeight > 0 && basePercent < 70) {
    warnings.push(
      `Base malt is only ${basePercent.toFixed(1)}% of grain bill. Consider 70-90% for most styles.`
    );
  }

  const zeroWeightItems = items.filter((item) => !item.weight_lbs);
  if (zeroWeightItems.length > 0) {
    warnings.push(
      `${zeroWeightItems.length} item(s) have no weight specified.`
    );
  }

  if (warnings.length === 0) return null;

  return (
    <div className="text-sm text-amber-600 dark:text-amber-400 space-y-1">
      {warnings.map((warning, i) => (
        <p key={i} className="flex items-center gap-1">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {warning}
        </p>
      ))}
    </div>
  );
}
