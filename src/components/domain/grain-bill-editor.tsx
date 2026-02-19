"use client";

/**
 * GrainBillEditor - Recipe Grain Bill Management Component
 *
 * Manages recipe malts in junction table format with searchable malt selector,
 * inline weight editing, automatic percentage calculation, and drag-to-reorder.
 */

import { useState, useMemo, useCallback } from "react";
import { useCatalog } from "@/hooks/use-catalog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import {
  Sortable,
  SortableContent,
  SortableItem,
  SortableItemHandle,
  SortableOverlay,
} from "@/components/ui/sortable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, GripVertical, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { catalogKeys } from "@/lib/query-keys";

export interface GrainBillItem {
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

interface MaltCatalogItem {
  id: string;
  name: string;
  maltster: string | null;
  type: string;
  color_lovibond: number | null;
  potential_ppg: number | null;
  bag_weight_lbs: number | null;
}

/** Malt type display labels for the selector grouping */
const MALT_TYPE_LABELS: Record<string, string> = {
  base: "Base Malts",
  specialty: "Specialty Malts",
  roasted: "Roasted Malts",
  adjunct: "Adjuncts",
  other: "Other",
};

interface GrainBillEditorProps {
  items: GrainBillItem[];
  onChange: (items: GrainBillItem[]) => void;
  disabled?: boolean;
}

export function GrainBillEditor({
  items,
  onChange,
  disabled = false,
}: GrainBillEditorProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  const { data: maltCatalog = [], isLoading: loadingMalts } = useCatalog<MaltCatalogItem>(catalogKeys.malts(), "malts", "id, name, maltster, type, color_lovibond, potential_ppg, bag_weight_lbs", ["type", "name"]);

  const totalWeight = useMemo(
    () => items.reduce((sum, item) => sum + (item.weight_lbs || 0), 0),
    [items]
  );

  const getPercentage = useCallback(
    (weight: number) => {
      if (totalWeight === 0) return 0;
      return (weight / totalWeight) * 100;
    },
    [totalWeight]
  );

  const handleAddMalt = useCallback(
    (malt: MaltCatalogItem) => {
      if (items.some((item) => item.malt_id === malt.id)) {
        setAddOpen(false);
        return;
      }

      const newItem: GrainBillItem = {
        id: crypto.randomUUID(),
        malt_id: malt.id,
        weight_lbs: 0,
        position: items.length,
        malt: malt,
      };

      onChange([...items, newItem]);
      setAddOpen(false);
      setSearchValue("");
    },
    [items, onChange]
  );

  const handleWeightChange = useCallback(
    (index: number, weight: number) => {
      const updated = [...items];
      updated[index] = { ...updated[index], weight_lbs: weight };
      onChange(updated);
    },
    [items, onChange]
  );

  const handleRemove = useCallback(
    (index: number) => {
      const updated = items.filter((_, i) => i !== index);
      updated.forEach((item, i) => {
        item.position = i;
      });
      onChange(updated);
    },
    [items, onChange]
  );

  const handleReorder = useCallback(
    (reordered: GrainBillItem[]) => {
      const updated = reordered.map((item, i) => ({
        ...item,
        position: i,
      }));
      onChange(updated);
    },
    [onChange]
  );

  /** Available (not-yet-added) malts grouped by type for the selector */
  const availableMaltsByType = useMemo(() => {
    const addedIds = new Set(items.map((item) => item.malt_id));
    const groups: Record<string, MaltCatalogItem[]> = {};
    for (const malt of maltCatalog) {
      if (addedIds.has(malt.id)) continue;
      const type = malt.type || "other";
      if (!groups[type]) groups[type] = [];
      groups[type].push(malt);
    }
    return groups;
  }, [maltCatalog, items]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || loadingMalts}
              className="gap-1"
            >
              <Plus className="h-4 w-4" />
              Add Malt
              <ChevronsUpDown className="h-3 w-3 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[400px] p-0" align="end">
            <Command>
              <CommandInput
                placeholder="Search malts..."
                value={searchValue}
                onValueChange={setSearchValue}
              />
              <CommandList>
                <CommandEmpty>No malts found.</CommandEmpty>
                {Object.entries(availableMaltsByType).map(([type, malts]) => (
                    <CommandGroup key={type} heading={MALT_TYPE_LABELS[type] || type}>
                      {malts.map((malt) => (
                        <CommandItem
                          key={malt.id}
                          value={`${malt.name} ${malt.maltster || ""}`}
                          onSelect={() => handleAddMalt(malt)}
                          className="flex items-center justify-between"
                        >
                          <div className="flex flex-col">
                            <span>{malt.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {malt.maltster}
                              {malt.color_lovibond && ` • ${malt.color_lovibond}°L`}
                              {malt.potential_ppg && ` • ${malt.potential_ppg} PPG`}
                            </span>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {items.length === 0 ? (
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          <p>No malts added yet.</p>
          <p className="text-sm mt-1">Click &quot;Add Malt&quot; to build your grain bill.</p>
        </div>
      ) : (
        <Sortable
          value={items}
          onValueChange={handleReorder}
          getItemValue={(item) => item.id!}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Malt</TableHead>
                <TableHead className="w-24 text-right">Weight (lbs)</TableHead>
                <TableHead className="w-16 text-right">Bags</TableHead>
                <TableHead className="w-20 text-right">%</TableHead>
                <TableHead className="w-20 text-right">°L</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <SortableContent asChild>
              <TableBody>
                {items.map((item, index) => {
                  const malt = item.malt || maltCatalog.find((m) => m.id === item.malt_id);
                  const percentage = getPercentage(item.weight_lbs);

                  return (
                    <SortableItem key={item.id} value={item.id!} asChild disabled={disabled}>
                      <TableRow>
                        <TableCell>
                          <SortableItemHandle className="p-1 hover:bg-muted rounded touch-none">
                            <GripVertical className="h-4 w-4 text-muted-foreground" />
                          </SortableItemHandle>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div>
                              <div className="font-medium">{malt?.name || "Unknown"}</div>
                              <div className="text-xs text-muted-foreground">
                                {malt?.maltster}
                              </div>
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
                              handleWeightChange(index, parseFloat(e.target.value) || 0)
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
                            className={cn(
                              "tabular-nums",
                              percentage >= 70 && "font-semibold text-primary"
                            )}
                          >
                            {percentage.toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {malt?.color_lovibond?.toFixed(1) || "—"}
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemove(index)}
                            disabled={disabled}
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    </SortableItem>
                  );
                })}
              </TableBody>
            </SortableContent>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="font-medium">
                  Total
                </TableCell>
                <TableCell className="text-right font-medium">
                  {totalWeight.toFixed(2)} lbs
                </TableCell>
                <TableCell></TableCell>
                <TableCell className="text-right font-medium">100%</TableCell>
                <TableCell colSpan={2}></TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          <SortableOverlay>
            {({ value }) => {
              const item = items.find((i) => i.id === value);
              const malt = item?.malt || maltCatalog.find((m) => m.id === item?.malt_id);
              return (
                <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 shadow-sm">
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{malt?.name || "Unknown"}</span>
                  {item && (
                    <span className="text-sm text-muted-foreground">
                      {item.weight_lbs ? `${item.weight_lbs} lbs` : ""}
                    </span>
                  )}
                </div>
              );
            }}
          </SortableOverlay>
        </Sortable>
      )}

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

  const zeroWeightItems = items.filter((item) => !item.weight_lbs || item.weight_lbs === 0);
  if (zeroWeightItems.length > 0) {
    warnings.push(
      `${zeroWeightItems.length} item(s) have no weight specified.`
    );
  }

  if (warnings.length === 0) return null;

  return (
    <div className="text-sm text-amber-600 dark:text-amber-400 space-y-1">
      {warnings.map((warning, i) => (
        <p key={i}>⚠️ {warning}</p>
      ))}
    </div>
  );
}
