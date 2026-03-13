"use client";

/**
 * AdjunctEditor - Recipe Adjunct Management Component
 *
 * Editor for managing recipe adjuncts in junction table format.
 * Features:
 * - Searchable adjunct selector from catalog
 * - Weight input
 * - Timing selection (mash, boil, fermentation)
 * - Reorder support
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { catalogKeys } from "@/lib/query-keys";
import { UnitDisplay } from "@/components/ui/unit-input";

// Types for adjunct entries
export interface AdjunctItem {
  id?: string;
  adjunct_id: string;
  weight_lbs: number;
  timing: "mash" | "boil" | "fermentation";
  position: number;
  notes?: string;
  adjunct?: {
    id: string;
    name: string;
    type: string;
    color_lovibond: number | null;
    potential_ppg: number | null;
    requires_mash: boolean;
  };
}

interface AdjunctCatalogItem {
  id: string;
  name: string;
  type: string;
  color_lovibond: number | null;
  potential_ppg: number | null;
  requires_mash: boolean;
}

interface AdjunctEditorProps {
  items: AdjunctItem[];
  onChange: (items: AdjunctItem[]) => void;
  disabled?: boolean;
}

const TIMING_OPTIONS = [
  { value: "mash", label: "Mash" },
  { value: "boil", label: "Boil" },
  { value: "fermentation", label: "Fermentation" },
] as const;

/** Domain constants: adjunct type labels (not entity status -- no stateMachine applies). */
const TYPE_LABELS: Record<string, string> = {
  grain: "Unmalted Grains",
  extract: "Extracts",
  other: "Other",
};

export function AdjunctEditor({
  items,
  onChange,
  disabled = false,
}: AdjunctEditorProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  // Fetch adjunct catalog
  const { data: adjunctCatalog = [], isLoading } = useCatalog<AdjunctCatalogItem>(catalogKeys.adjuncts(), "adjuncts", "id, name, type, color_lovibond, potential_ppg, requires_mash", ["type", "name"]);

  // Calculate totals
  const totals = useMemo(() => {
    const totalWeight = items.reduce((sum, item) => sum + (item.weight_lbs || 0), 0);
    return { totalWeight };
  }, [items]);

  // Add adjunct
  const handleAdd = useCallback(
    (adjunct: AdjunctCatalogItem) => {
      if (items.some((item) => item.adjunct_id === adjunct.id)) {
        setAddOpen(false);
        return;
      }

      const newItem: AdjunctItem = {
        adjunct_id: adjunct.id,
        weight_lbs: 0,
        timing: adjunct.requires_mash ? "mash" : "boil",
        position: items.length,
        adjunct: adjunct,
      };

      onChange([...items, newItem]);
      setAddOpen(false);
      setSearchValue("");
    },
    [items, onChange]
  );

  // Update weight
  const handleWeightChange = useCallback(
    (index: number, weight: number) => {
      const updated = [...items];
      updated[index] = { ...updated[index], weight_lbs: weight };
      onChange(updated);
    },
    [items, onChange]
  );

  // Update timing
  const handleTimingChange = useCallback(
    (index: number, timing: AdjunctItem["timing"]) => {
      const updated = [...items];
      updated[index] = { ...updated[index], timing };
      onChange(updated);
    },
    [items, onChange]
  );

  // Remove item
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

  // Move item
  const handleMove = useCallback(
    (index: number, direction: "up" | "down") => {
      if (direction === "up" && index === 0) return;
      if (direction === "down" && index === items.length - 1) return;

      const updated = [...items];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      [updated[index], updated[targetIndex]] = [updated[targetIndex], updated[index]];
      updated.forEach((item, i) => {
        item.position = i;
      });
      onChange(updated);
    },
    [items, onChange]
  );

  // Group by type
  const adjunctsByType = useMemo(() => {
    const groups: Record<string, AdjunctCatalogItem[]> = {};
    adjunctCatalog.forEach((adj) => {
      const type = adj.type || "other";
      if (!groups[type]) groups[type] = [];
      groups[type].push(adj);
    });
    return groups;
  }, [adjunctCatalog]);

  // Filter out already-added
  const availableAdjuncts = useMemo(() => {
    const addedIds = new Set(items.map((item) => item.adjunct_id));
    return adjunctCatalog.filter((adj) => !addedIds.has(adj.id));
  }, [adjunctCatalog, items]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Adjuncts</h3>
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || isLoading}
              className="gap-1"
            >
              <Plus className="h-4 w-4" />
              Add Adjunct
              <ChevronsUpDown className="h-3 w-3 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[400px] p-0" align="end">
            <Command>
              <CommandInput
                placeholder="Search adjuncts..."
                value={searchValue}
                onValueChange={setSearchValue}
              />
              <CommandList>
                <CommandEmpty>No adjuncts found.</CommandEmpty>
                {Object.entries(adjunctsByType).map(([type, adjuncts]) => {
                  const available = adjuncts.filter((a) =>
                    availableAdjuncts.some((aa) => aa.id === a.id)
                  );
                  if (available.length === 0) return null;

                  return (
                    <CommandGroup key={type} heading={TYPE_LABELS[type] || type}>
                      {available.map((adjunct) => (
                        <CommandItem
                          key={adjunct.id}
                          value={adjunct.name}
                          onSelect={() => handleAdd(adjunct)}
                          className="flex items-center justify-between"
                        >
                          <div className="flex flex-col">
                            <span>{adjunct.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {adjunct.color_lovibond && `${adjunct.color_lovibond}°L`}
                              {adjunct.potential_ppg && ` • ${adjunct.potential_ppg} PPG`}
                              {adjunct.requires_mash && " • Requires Mash"}
                            </span>
                          </div>
                          {items.some((item) => item.adjunct_id === adjunct.id) && (
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
          <p>No adjuncts added yet.</p>
          <p className="text-sm mt-1">Click &quot;Add Adjunct&quot; to add unmalted grains, extracts, etc.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Adjunct</TableHead>
              <TableHead className="w-24 text-right">Weight (lbs)</TableHead>
              <TableHead className="w-32">Timing</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => {
              const adjunct = item.adjunct || adjunctCatalog.find((a) => a.id === item.adjunct_id);

              return (
                <TableRow key={item.adjunct_id}>
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
                        <div className="font-medium">{adjunct?.name || "Unknown"}</div>
                        <div className="text-xs text-muted-foreground">
                          {adjunct?.color_lovibond && `${adjunct.color_lovibond}°L`}
                          {adjunct?.potential_ppg && ` • ${adjunct.potential_ppg} PPG`}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {adjunct?.type}
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
                  <TableCell>
                    <Select
                      value={item.timing}
                      onValueChange={(value) =>
                        handleTimingChange(index, value as AdjunctItem["timing"])
                      }
                      disabled={disabled}
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIMING_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                <UnitDisplay value={totals.totalWeight} unitType="weight" />
              </TableCell>
              <TableCell colSpan={2}></TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </div>
  );
}
