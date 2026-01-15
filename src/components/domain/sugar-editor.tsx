"use client";

/**
 * SugarEditor - Recipe Sugar Management Component
 *
 * Editor for managing recipe sugars in junction table format.
 * Features:
 * - Searchable sugar selector from catalog
 * - Weight input with gravity contribution indication
 * - Timing selection (boil, fermentation, packaging)
 * - Reorder support
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

// Types for sugar entries
export interface SugarItem {
  id?: string;
  sugar_id: string;
  weight_lbs: number;
  timing: "boil" | "fermentation" | "packaging";
  position: number;
  notes?: string;
  sugar?: {
    id: string;
    name: string;
    type: string;
    color_lovibond: number | null;
    potential_ppg: number | null;
    fermentability: number | null;
  };
}

interface SugarCatalogItem {
  id: string;
  name: string;
  type: string;
  color_lovibond: number | null;
  potential_ppg: number | null;
  fermentability: number | null;
}

interface SugarEditorProps {
  items: SugarItem[];
  onChange: (items: SugarItem[]) => void;
  disabled?: boolean;
}

const TIMING_OPTIONS = [
  { value: "boil", label: "Boil" },
  { value: "fermentation", label: "Fermentation" },
  { value: "packaging", label: "Packaging" },
] as const;

const TYPE_LABELS: Record<string, string> = {
  simple: "Simple Sugars",
  invert: "Invert Sugars",
  honey: "Honey",
  maple: "Maple",
  molasses: "Molasses",
  other: "Other",
};

export function SugarEditor({
  items,
  onChange,
  disabled = false,
}: SugarEditorProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const supabase = createClient();

  // Fetch sugar catalog
  const { data: sugarCatalog = [], isLoading } = useQuery({
    queryKey: ["sugars-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sugars")
        .select("id, name, type, color_lovibond, potential_ppg, fermentability")
        .eq("is_active", true)
        .order("type")
        .order("name");
      if (error) throw error;
      return data as SugarCatalogItem[];
    },
  });

  // Calculate totals
  const totals = useMemo(() => {
    const totalWeight = items.reduce((sum, item) => sum + (item.weight_lbs || 0), 0);
    return { totalWeight };
  }, [items]);

  // Add sugar
  const handleAdd = useCallback(
    (sugar: SugarCatalogItem) => {
      if (items.some((item) => item.sugar_id === sugar.id)) {
        setAddOpen(false);
        return;
      }

      const newItem: SugarItem = {
        sugar_id: sugar.id,
        weight_lbs: 0,
        timing: "boil",
        position: items.length,
        sugar: sugar,
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
    (index: number, timing: SugarItem["timing"]) => {
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
  const sugarsByType = useMemo(() => {
    const groups: Record<string, SugarCatalogItem[]> = {};
    sugarCatalog.forEach((sugar) => {
      const type = sugar.type || "other";
      if (!groups[type]) groups[type] = [];
      groups[type].push(sugar);
    });
    return groups;
  }, [sugarCatalog]);

  // Filter out already-added
  const availableSugars = useMemo(() => {
    const addedIds = new Set(items.map((item) => item.sugar_id));
    return sugarCatalog.filter((s) => !addedIds.has(s.id));
  }, [sugarCatalog, items]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Sugars</h3>
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || isLoading}
              className="gap-1"
            >
              <Plus className="h-4 w-4" />
              Add Sugar
              <ChevronsUpDown className="h-3 w-3 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[400px] p-0" align="end">
            <Command>
              <CommandInput
                placeholder="Search sugars..."
                value={searchValue}
                onValueChange={setSearchValue}
              />
              <CommandList>
                <CommandEmpty>No sugars found.</CommandEmpty>
                {Object.entries(sugarsByType).map(([type, sugars]) => {
                  const available = sugars.filter((s) =>
                    availableSugars.some((as) => as.id === s.id)
                  );
                  if (available.length === 0) return null;

                  return (
                    <CommandGroup key={type} heading={TYPE_LABELS[type] || type}>
                      {available.map((sugar) => (
                        <CommandItem
                          key={sugar.id}
                          value={sugar.name}
                          onSelect={() => handleAdd(sugar)}
                          className="flex items-center justify-between"
                        >
                          <div className="flex flex-col">
                            <span>{sugar.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {sugar.potential_ppg && `${sugar.potential_ppg} PPG`}
                              {sugar.fermentability && ` • ${sugar.fermentability}% ferm`}
                              {sugar.color_lovibond && ` • ${sugar.color_lovibond}°L`}
                            </span>
                          </div>
                          {items.some((item) => item.sugar_id === sugar.id) && (
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
          <p>No sugars added yet.</p>
          <p className="text-sm mt-1">Click &quot;Add Sugar&quot; to add honey, table sugar, etc.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Sugar</TableHead>
              <TableHead className="w-24 text-right">Weight (lbs)</TableHead>
              <TableHead className="w-20 text-right">PPG</TableHead>
              <TableHead className="w-32">Timing</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => {
              const sugar = item.sugar || sugarCatalog.find((s) => s.id === item.sugar_id);

              return (
                <TableRow key={item.sugar_id}>
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
                        <div className="font-medium">{sugar?.name || "Unknown"}</div>
                        <div className="text-xs text-muted-foreground">
                          {sugar?.fermentability && `${sugar.fermentability}% fermentable`}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {sugar?.type}
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
                  <TableCell className="text-right text-muted-foreground">
                    {sugar?.potential_ppg?.toFixed(0) || "—"}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={item.timing}
                      onValueChange={(value) =>
                        handleTimingChange(index, value as SugarItem["timing"])
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
                {totals.totalWeight.toFixed(2)} lbs
              </TableCell>
              <TableCell colSpan={3}></TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </div>
  );
}
