"use client";

/**
 * GrainBillEditor - Recipe Grain Bill Management Component
 *
 * A specialized editor for managing recipe malts in junction table format.
 * Features:
 * - Searchable malt selector from catalog
 * - Inline weight editing
 * - Automatic percentage calculation
 * - Drag-to-reorder (position)
 * - Real-time totals
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
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
import { Plus, Trash2, GripVertical, Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Types for grain bill entries
export interface GrainBillItem {
  id?: string;
  malt_id: string;
  weight_lbs: number;
  position: number;
  // Joined data (read-only)
  malt?: {
    id: string;
    name: string;
    maltster: string | null;
    type: string;
    color_lovibond: number | null;
    potential_ppg: number | null;
  };
}

interface MaltCatalogItem {
  id: string;
  name: string;
  maltster: string | null;
  type: string;
  color_lovibond: number | null;
  potential_ppg: number | null;
}

interface GrainBillEditorProps {
  /** Current grain bill items */
  items: GrainBillItem[];
  /** Callback when items change */
  onChange: (items: GrainBillItem[]) => void;
  /** Whether the editor is disabled */
  disabled?: boolean;
  /** Recipe ID for context */
  recipeId?: string;
}

export function GrainBillEditor({
  items,
  onChange,
  disabled = false,
}: GrainBillEditorProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const supabase = createClient();

  // Fetch malt catalog
  const { data: maltCatalog = [], isLoading: loadingMalts } = useQuery({
    queryKey: ["malts-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("malts")
        .select("id, name, maltster, type, color_lovibond, potential_ppg")
        .eq("is_active", true)
        .order("type")
        .order("name");
      if (error) throw error;
      return data as MaltCatalogItem[];
    },
  });

  // Calculate totals
  const totals = useMemo(() => {
    const totalWeight = items.reduce((sum, item) => sum + (item.weight_lbs || 0), 0);
    return { totalWeight };
  }, [items]);

  // Get percentage for an item
  const getPercentage = useCallback(
    (weight: number) => {
      if (totals.totalWeight === 0) return 0;
      return (weight / totals.totalWeight) * 100;
    },
    [totals.totalWeight]
  );

  // Add a new malt to the grain bill
  const handleAddMalt = useCallback(
    (malt: MaltCatalogItem) => {
      // Check if already added
      if (items.some((item) => item.malt_id === malt.id)) {
        setAddOpen(false);
        return;
      }

      const newItem: GrainBillItem = {
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

  // Update weight for an item
  const handleWeightChange = useCallback(
    (index: number, weight: number) => {
      const updated = [...items];
      updated[index] = { ...updated[index], weight_lbs: weight };
      onChange(updated);
    },
    [items, onChange]
  );

  // Remove an item
  const handleRemove = useCallback(
    (index: number) => {
      const updated = items.filter((_, i) => i !== index);
      // Update positions
      updated.forEach((item, i) => {
        item.position = i;
      });
      onChange(updated);
    },
    [items, onChange]
  );

  // Move item up/down
  const handleMove = useCallback(
    (index: number, direction: "up" | "down") => {
      if (direction === "up" && index === 0) return;
      if (direction === "down" && index === items.length - 1) return;

      const updated = [...items];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      [updated[index], updated[targetIndex]] = [updated[targetIndex], updated[index]];

      // Update positions
      updated.forEach((item, i) => {
        item.position = i;
      });
      onChange(updated);
    },
    [items, onChange]
  );

  // Group malts by type for the selector
  const maltsByType = useMemo(() => {
    const groups: Record<string, MaltCatalogItem[]> = {};
    maltCatalog.forEach((malt) => {
      const type = malt.type || "other";
      if (!groups[type]) groups[type] = [];
      groups[type].push(malt);
    });
    return groups;
  }, [maltCatalog]);

  // Filter out already-added malts
  const availableMalts = useMemo(() => {
    const addedIds = new Set(items.map((item) => item.malt_id));
    return maltCatalog.filter((malt) => !addedIds.has(malt.id));
  }, [maltCatalog, items]);

  // Type labels for display
  const typeLabels: Record<string, string> = {
    base: "Base Malts",
    specialty: "Specialty Malts",
    roasted: "Roasted Malts",
    adjunct: "Adjuncts",
    other: "Other",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Grain Bill</h3>
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
                {Object.entries(maltsByType).map(([type, malts]) => {
                  const available = malts.filter((m) =>
                    availableMalts.some((am) => am.id === m.id)
                  );
                  if (available.length === 0) return null;

                  return (
                    <CommandGroup key={type} heading={typeLabels[type] || type}>
                      {available.map((malt) => (
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
                          {items.some((item) => item.malt_id === malt.id) && (
                            <Check className="h-4 w-4 text-primary" />
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  );
                })}
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Malt</TableHead>
              <TableHead className="w-24 text-right">Weight (lbs)</TableHead>
              <TableHead className="w-20 text-right">%</TableHead>
              <TableHead className="w-20 text-right">°L</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => {
              const malt = item.malt || maltCatalog.find((m) => m.id === item.malt_id);
              const percentage = getPercentage(item.weight_lbs);

              return (
                <TableRow key={item.malt_id}>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={() => handleMove(index, "up")}
                        disabled={disabled || index === 0}
                        className="p-0.5 hover:bg-muted rounded disabled:opacity-30"
                      >
                        <GripVertical className="h-3 w-3 rotate-180" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMove(index, "down")}
                        disabled={disabled || index === items.length - 1}
                        className="p-0.5 hover:bg-muted rounded disabled:opacity-30"
                      >
                        <GripVertical className="h-3 w-3" />
                      </button>
                    </div>
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
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2} className="font-medium">
                Total
              </TableCell>
              <TableCell className="text-right font-medium">
                {totals.totalWeight.toFixed(2)} lbs
              </TableCell>
              <TableCell className="text-right font-medium">100%</TableCell>
              <TableCell colSpan={2}></TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}

      {/* Warnings */}
      {items.length > 0 && (
        <GrainBillWarnings items={items} totalWeight={totals.totalWeight} />
      )}
    </div>
  );
}

// Component for showing grain bill warnings/suggestions
function GrainBillWarnings({
  items,
  totalWeight,
}: {
  items: GrainBillItem[];
  totalWeight: number;
}) {
  const warnings: string[] = [];

  // Check for base malt percentage (should be 70-90% typically)
  const baseMalts = items.filter((item) => item.malt?.type === "base");
  const baseWeight = baseMalts.reduce((sum, item) => sum + (item.weight_lbs || 0), 0);
  const basePercent = totalWeight > 0 ? (baseWeight / totalWeight) * 100 : 0;

  if (totalWeight > 0 && basePercent < 70) {
    warnings.push(
      `Base malt is only ${basePercent.toFixed(1)}% of grain bill. Consider 70-90% for most styles.`
    );
  }

  // Check for any items with 0 weight
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
