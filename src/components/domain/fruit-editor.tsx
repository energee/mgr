"use client";

/**
 * FruitEditor - Recipe Fruit Management Component
 *
 * Editor for managing recipe fruits in junction table format.
 * Features:
 * - Searchable fruit selector from catalog
 * - Amount input with unit selection
 * - Timing selection (boil_end, primary, secondary, packaging)
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

// Types for fruit entries
export interface FruitItem {
  id?: string;
  fruit_id: string;
  amount: number;
  unit: "lbs" | "oz" | "gal" | "l" | "can";
  timing: "boil_end" | "primary" | "secondary" | "packaging";
  position: number;
  notes?: string;
  fruit?: {
    id: string;
    name: string;
    type: string;
    form: string;
    sugar_content: number | null;
  };
}

interface FruitCatalogItem {
  id: string;
  name: string;
  type: string;
  form: string;
  sugar_content: number | null;
}

interface FruitEditorProps {
  items: FruitItem[];
  onChange: (items: FruitItem[]) => void;
  disabled?: boolean;
}

const TIMING_OPTIONS = [
  { value: "boil_end", label: "End of Boil" },
  { value: "primary", label: "Primary Fermentation" },
  { value: "secondary", label: "Secondary" },
  { value: "packaging", label: "Packaging" },
] as const;

const UNIT_OPTIONS = [
  { value: "lbs", label: "lbs" },
  { value: "oz", label: "oz" },
  { value: "gal", label: "gal" },
  { value: "l", label: "L" },
  { value: "can", label: "can" },
] as const;

const TYPE_LABELS: Record<string, string> = {
  puree: "Purees",
  whole: "Whole Fruit",
  juice: "Juice",
  concentrate: "Concentrates",
  dried: "Dried",
  other: "Other",
};

const FORM_LABELS: Record<string, string> = {
  fresh: "Fresh",
  frozen: "Frozen",
  aseptic: "Aseptic",
  canned: "Canned",
};

export function FruitEditor({
  items,
  onChange,
  disabled = false,
}: FruitEditorProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  // Fetch fruit catalog
  const { data: fruitCatalog = [], isLoading } = useCatalog<FruitCatalogItem>(catalogKeys.fruits(), "fruits", "id, name, type, form, sugar_content", ["type", "name"]);

  // Calculate totals
  const totals = useMemo(() => {
    // Sum by lbs (convert oz to lbs)
    const totalLbs = items.reduce((sum, item) => {
      if (item.unit === "lbs") return sum + (item.amount || 0);
      if (item.unit === "oz") return sum + (item.amount || 0) / 16;
      return sum;
    }, 0);
    return { totalLbs };
  }, [items]);

  // Add fruit
  const handleAdd = useCallback(
    (fruit: FruitCatalogItem) => {
      if (items.some((item) => item.fruit_id === fruit.id)) {
        setAddOpen(false);
        return;
      }

      const newItem: FruitItem = {
        fruit_id: fruit.id,
        amount: 0,
        unit: "lbs",
        timing: "secondary",
        position: items.length,
        fruit: fruit,
      };

      onChange([...items, newItem]);
      setAddOpen(false);
      setSearchValue("");
    },
    [items, onChange]
  );

  // Update amount
  const handleAmountChange = useCallback(
    (index: number, amount: number) => {
      const updated = [...items];
      updated[index] = { ...updated[index], amount };
      onChange(updated);
    },
    [items, onChange]
  );

  // Update unit
  const handleUnitChange = useCallback(
    (index: number, unit: FruitItem["unit"]) => {
      const updated = [...items];
      updated[index] = { ...updated[index], unit };
      onChange(updated);
    },
    [items, onChange]
  );

  // Update timing
  const handleTimingChange = useCallback(
    (index: number, timing: FruitItem["timing"]) => {
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
  const fruitsByType = useMemo(() => {
    const groups: Record<string, FruitCatalogItem[]> = {};
    fruitCatalog.forEach((fruit) => {
      const type = fruit.type || "other";
      if (!groups[type]) groups[type] = [];
      groups[type].push(fruit);
    });
    return groups;
  }, [fruitCatalog]);

  // Filter out already-added
  const availableFruits = useMemo(() => {
    const addedIds = new Set(items.map((item) => item.fruit_id));
    return fruitCatalog.filter((f) => !addedIds.has(f.id));
  }, [fruitCatalog, items]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Fruits</h3>
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || isLoading}
              className="gap-1"
            >
              <Plus className="h-4 w-4" />
              Add Fruit
              <ChevronsUpDown className="h-3 w-3 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[400px] p-0" align="end">
            <Command>
              <CommandInput
                placeholder="Search fruits..."
                value={searchValue}
                onValueChange={setSearchValue}
              />
              <CommandList>
                <CommandEmpty>No fruits found.</CommandEmpty>
                {Object.entries(fruitsByType).map(([type, fruits]) => {
                  const available = fruits.filter((f) =>
                    availableFruits.some((af) => af.id === f.id)
                  );
                  if (available.length === 0) return null;

                  return (
                    <CommandGroup key={type} heading={TYPE_LABELS[type] || type}>
                      {available.map((fruit) => (
                        <CommandItem
                          key={fruit.id}
                          value={`${fruit.name} ${fruit.form}`}
                          onSelect={() => handleAdd(fruit)}
                          className="flex items-center justify-between"
                        >
                          <div className="flex flex-col">
                            <span>{fruit.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {FORM_LABELS[fruit.form] || fruit.form}
                              {fruit.sugar_content && ` • ${fruit.sugar_content}° Brix`}
                            </span>
                          </div>
                          {items.some((item) => item.fruit_id === fruit.id) && (
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
          <p>No fruits added yet.</p>
          <p className="text-sm mt-1">Click &quot;Add Fruit&quot; to add purees, whole fruit, etc.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Fruit</TableHead>
              <TableHead className="w-20 text-right">Amount</TableHead>
              <TableHead className="w-16">Unit</TableHead>
              <TableHead className="w-36">Timing</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => {
              const fruit = item.fruit || fruitCatalog.find((f) => f.id === item.fruit_id);

              return (
                <TableRow key={item.fruit_id}>
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
                        <div className="font-medium">{fruit?.name || "Unknown"}</div>
                        <div className="text-xs text-muted-foreground">
                          {fruit?.form && (FORM_LABELS[fruit.form] || fruit.form)}
                          {fruit?.sugar_content && ` • ${fruit.sugar_content}° Brix`}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {TYPE_LABELS[fruit?.type || "other"] || fruit?.type}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      step="0.25"
                      min="0"
                      value={item.amount || ""}
                      onChange={(e) =>
                        handleAmountChange(index, parseFloat(e.target.value) || 0)
                      }
                      disabled={disabled}
                      className="w-16 text-right"
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={item.unit}
                      onValueChange={(value) =>
                        handleUnitChange(index, value as FruitItem["unit"])
                      }
                      disabled={disabled}
                    >
                      <SelectTrigger className="w-14">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {UNIT_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={item.timing}
                      onValueChange={(value) =>
                        handleTimingChange(index, value as FruitItem["timing"])
                      }
                      disabled={disabled}
                    >
                      <SelectTrigger className="w-32">
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
                Total (lbs equivalent)
              </TableCell>
              <TableCell className="text-right font-medium">
                {totals.totalLbs.toFixed(2)}
              </TableCell>
              <TableCell colSpan={3}></TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </div>
  );
}
