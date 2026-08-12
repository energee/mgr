"use client";

/**
 * HopScheduleEditor - Recipe Hop Schedule Management Component
 *
 * Manages recipe hops in junction table format with searchable selector,
 * timing/boil-time inputs, IBU estimates (Tinseth), and drag-to-reorder.
 */

import { useMemo, useCallback } from "react";
import { getHopUtilizationFactor } from "@/domain/recipe-estimate-calc";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { catalogKeys } from "@/lib/query-keys";
import { UnitDisplay } from "@/components/ui/unit-input";

export const HOP_TIMINGS = [
  { value: "first_wort", label: "First Wort", description: "Added during lautering" },
  { value: "boil", label: "Boil", description: "Added during boil" },
  { value: "whirlpool", label: "Whirlpool", description: "Added at flameout/whirlpool" },
  { value: "dry_hop", label: "Dry Hop", description: "Added during fermentation" },
] as const;

export type HopTiming = (typeof HOP_TIMINGS)[number]["value"];

/** Ounces per pound, used for oz (storage) to lbs (display) conversion */
const OZ_PER_LB = 16;

/** Display text for non-boil timing columns */
const TIMING_DISPLAY: Record<string, string> = {
  first_wort: "60 min",
  whirlpool: "0 min",
  dry_hop: "\u2014",
};

export type HopScheduleItem = {
  id?: string;
  hop_id: string;
  weight_oz: number;
  timing: HopTiming;
  boil_time_min: number | null;
  position: number;
  /** Joined data (read-only) */
  hop?: {
    id: string;
    name: string;
    origin: string | null;
    type: string | null;
    alpha_acid_typical: number | null;
    flavor_profile: string | null;
    bag_weight_lbs: number | null;
  };
}

type HopCatalogItem = {
  id: string;
  name: string;
  origin: string | null;
  type: string | null;
  alpha_acid_typical: number | null;
  flavor_profile: string | null;
  bag_weight_lbs: number | null;
}

/** Hop type display labels for the selector grouping */
/** Domain constants: hop category labels (not entity status -- no stateMachine applies). */
const HOP_TYPE_LABELS: Record<string, string> = {
  bittering: "Bittering Hops",
  aroma: "Aroma Hops",
  dual: "Dual Purpose",
};

type HopScheduleEditorProps = {
  items: HopScheduleItem[];
  onChange: (items: HopScheduleItem[]) => void;
  disabled?: boolean;
  /** Recipe batch size in gallons (for IBU calculation) */
  batchSizeGal?: number;
  /** Recipe OG (for IBU calculation) */
  estimatedOG?: number;
}

export function HopScheduleEditor({
  items,
  onChange,
  disabled = false,
  batchSizeGal = 5,
  estimatedOG = 1.050,
}: HopScheduleEditorProps) {
  const rows = useSortableRows({ items, onChange });

  const { data: hopCatalog = [], isLoading: loadingHops } = useCatalog<HopCatalogItem>(catalogKeys.hops(), "hops", "id, name, origin, type, alpha_acid_typical, flavor_profile, bag_weight_lbs", ["type", "name"]);

  /** IBU contribution for a single hop addition (delegates to shared Tinseth formula) */
  const calculateIBU = useCallback(
    (item: HopScheduleItem): number => {
      if (!item.hop?.alpha_acid_typical || !item.weight_oz) return 0;
      const utilization = getHopUtilizationFactor(item.timing, item.boil_time_min, estimatedOG);
      if (utilization <= 0) return 0;
      const aau = item.weight_oz * item.hop.alpha_acid_typical;
      return (aau * utilization * 74.89) / batchSizeGal;
    },
    [batchSizeGal, estimatedOG]
  );

  const totals = useMemo(() => ({
    totalWeight: items.reduce((sum, item) => sum + (item.weight_oz || 0), 0),
    totalIBU: items.reduce((sum, item) => sum + calculateIBU(item), 0),
  }), [items, calculateIBU]);

  /**
   * Timing drives boil time: leaving the boil (and first wort, which has its own
   * fixed utilization) clears the minutes; returning to the boil restores the
   * 60-minute default rather than leaving the field blank.
   */
  const handleTimingChange = useCallback(
    (index: number, timing: HopTiming) => {
      const patch: Partial<HopScheduleItem> = { timing };
      if (timing !== "boil" && timing !== "first_wort") patch.boil_time_min = null;
      if (timing === "boil" && !items[index].boil_time_min) patch.boil_time_min = 60;
      rows.update(index, patch);
    },
    [items, rows]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <CatalogAddPopover
          catalog={hopCatalog}
          getGroup={(hop) => hop.type || "dual"}
          groupLabels={HOP_TYPE_LABELS}
          getSearchValue={(hop) => `${hop.name} ${hop.origin || ""}`}
          getDetail={(hop) => (
            <span className="text-xs text-muted-foreground">
              {hop.origin}
              {hop.alpha_acid_typical && ` • ${hop.alpha_acid_typical}% AA`}
            </span>
          )}
          onSelect={(hop) =>
            rows.append({
              id: crypto.randomUUID(),
              hop_id: hop.id,
              weight_oz: 0,
              timing: "boil",
              boil_time_min: 60,
              hop,
            })
          }
          triggerLabel="Add Hop"
          searchPlaceholder="Search hops..."
          emptyMessage="No hops found."
          disabled={disabled || loadingHops}
        />
      </div>

      <SortableRows
        items={items}
        onReorder={rows.reorder}
        disabled={disabled}
        columns={[
          { className: "w-8" },
          { label: "Hop" },
          { label: "Timing", className: "w-28" },
          { label: "Time", className: "w-20 text-right" },
          { label: "Lbs", className: "w-20 text-right" },
          { label: "Bags", className: "w-16 text-right" },
          { label: "AA%", className: "w-16 text-right" },
          { label: "IBU", className: "w-16 text-right" },
          { className: "w-16" },
        ]}
        empty={
          <div className="border rounded-md p-8 text-center text-muted-foreground">
            <p>No hops added yet.</p>
            <p className="text-sm mt-1">Click &quot;Add Hop&quot; to build your hop schedule.</p>
          </div>
        }
        overlay={(item) => (
          <SortableDragPreview
            title={(item?.hop || hopCatalog.find((h) => h.id === item?.hop_id))?.name || "Unknown"}
            subtitle={
              item && HOP_TIMINGS.find((t) => t.value === item.timing)?.label
            }
          />
        )}
        footer={
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4} className="font-medium">
                Total
              </TableCell>
              <TableCell className="text-right font-medium">
                <UnitDisplay value={totals.totalWeight / OZ_PER_LB} unitType="weight" />
              </TableCell>
              <TableCell></TableCell>
              <TableCell></TableCell>
              <TableCell className="text-right font-medium">
                {totals.totalIBU.toFixed(0)} IBU
              </TableCell>
              <TableCell></TableCell>
            </TableRow>
          </TableFooter>
        }
      >
        {(item, index) => {
          const hop = item.hop || hopCatalog.find((h) => h.id === item.hop_id);
          const ibu = calculateIBU(item);

          return (
            <TableRow>
              <SortableHandleCell />
              <TableCell>
                <div>
                  <div className="font-medium">{hop?.name || "Unknown"}</div>
                  <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                    {hop?.flavor_profile}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <Select
                  value={item.timing}
                  onValueChange={(value) => handleTimingChange(index, value as HopTiming)}
                  disabled={disabled}
                >
                  <SelectTrigger className="w-full h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOP_TIMINGS.map((timing) => (
                      <SelectItem key={timing.value} value={timing.value}>
                        {timing.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell className="text-right">
                {item.timing === "boil" ? (
                  <Input
                    type="number"
                    min="0"
                    max="120"
                    value={item.boil_time_min ?? ""}
                    onChange={(e) =>
                      rows.updateField(
                        index,
                        "boil_time_min",
                        e.target.value ? parseInt(e.target.value) : null
                      )
                    }
                    disabled={disabled}
                    className="w-16 text-right"
                    placeholder="min"
                  />
                ) : (
                  <span className="text-muted-foreground text-sm">
                    {TIMING_DISPLAY[item.timing]}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <Input
                  type="number"
                  step="0.25"
                  min="0"
                  value={item.weight_oz ? item.weight_oz / OZ_PER_LB : ""}
                  onChange={(e) =>
                    rows.updateField(
                      index,
                      "weight_oz",
                      (parseFloat(e.target.value) || 0) * OZ_PER_LB
                    )
                  }
                  disabled={disabled}
                  className="w-16 text-right"
                />
              </TableCell>
              <TableCell className="text-right text-muted-foreground tabular-nums">
                {hop?.bag_weight_lbs
                  ? (item.weight_oz / OZ_PER_LB / hop.bag_weight_lbs).toFixed(1)
                  : "—"}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {hop?.alpha_acid_typical?.toFixed(1) || "—"}
              </TableCell>
              <TableCell className="text-right">
                <span className={cn("tabular-nums", ibu > 0 && "font-medium")}>
                  {ibu > 0 ? ibu.toFixed(1) : "—"}
                </span>
              </TableCell>
              <RemoveRowCell onClick={() => rows.remove(index)} disabled={disabled} />
            </TableRow>
          );
        }}
      </SortableRows>

      {items.length > 0 && (
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          {HOP_TIMINGS.map((timing) => (
            <div key={timing.value} className="flex items-center gap-1">
              <Badge variant="outline" className="text-xs">
                {timing.label}
              </Badge>
              <span>{timing.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
