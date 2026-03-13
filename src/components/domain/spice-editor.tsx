"use client";

/**
 * SpiceEditor - Recipe Spice/Herb Management Component
 *
 * Editor for managing recipe spices and herbs in junction table format.
 * Features:
 * - Searchable spice selector from catalog
 * - Amount input with unit selection
 * - Timing selection (boil, whirlpool, fermentation, secondary)
 * - Boil time for boil additions
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

// Types for spice entries
export interface SpiceItem {
  id?: string;
  spice_id: string;
  amount: number;
  unit: "oz" | "g" | "tsp" | "tbsp" | "each";
  timing: "boil" | "whirlpool" | "fermentation" | "secondary";
  boil_time_min?: number;
  position: number;
  notes?: string;
  spice?: {
    id: string;
    name: string;
    type: string;
    typical_amount: number | null;
    typical_unit: string | null;
  };
}

interface SpiceCatalogItem {
  id: string;
  name: string;
  type: string;
  typical_amount: number | null;
  typical_unit: string | null;
}

interface SpiceEditorProps {
  items: SpiceItem[];
  onChange: (items: SpiceItem[]) => void;
  disabled?: boolean;
}

const TIMING_OPTIONS = [
  { value: "boil", label: "Boil" },
  { value: "whirlpool", label: "Whirlpool" },
  { value: "fermentation", label: "Fermentation" },
  { value: "secondary", label: "Secondary" },
] as const;

const UNIT_OPTIONS = [
  { value: "oz", label: "oz" },
  { value: "g", label: "g" },
  { value: "tsp", label: "tsp" },
  { value: "tbsp", label: "tbsp" },
  { value: "each", label: "each" },
] as const;

/** Domain constants: spice/herb type labels (not entity status -- no stateMachine applies). */
const TYPE_LABELS: Record<string, string> = {
  spice: "Spices",
  herb: "Herbs",
  botanical: "Botanicals",
  other: "Other",
};

export function SpiceEditor({
  items,
  onChange,
  disabled = false,
}: SpiceEditorProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  // Fetch spice catalog
  const { data: spiceCatalog = [], isLoading } = useCatalog<SpiceCatalogItem>(catalogKeys.spices(), "spices", "id, name, type, typical_amount, typical_unit", ["type", "name"]);

  // Add spice
  const handleAdd = useCallback(
    (spice: SpiceCatalogItem) => {
      if (items.some((item) => item.spice_id === spice.id)) {
        setAddOpen(false);
        return;
      }

      const newItem: SpiceItem = {
        spice_id: spice.id,
        amount: spice.typical_amount || 0,
        unit: (spice.typical_unit as SpiceItem["unit"]) || "oz",
        timing: "boil",
        boil_time_min: 5,
        position: items.length,
        spice: spice,
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
    (index: number, unit: SpiceItem["unit"]) => {
      const updated = [...items];
      updated[index] = { ...updated[index], unit };
      onChange(updated);
    },
    [items, onChange]
  );

  // Update timing
  const handleTimingChange = useCallback(
    (index: number, timing: SpiceItem["timing"]) => {
      const updated = [...items];
      updated[index] = { ...updated[index], timing };
      // Clear boil time if not boil
      if (timing !== "boil") {
        updated[index].boil_time_min = undefined;
      } else if (!updated[index].boil_time_min) {
        updated[index].boil_time_min = 5;
      }
      onChange(updated);
    },
    [items, onChange]
  );

  // Update boil time
  const handleBoilTimeChange = useCallback(
    (index: number, boilTime: number) => {
      const updated = [...items];
      updated[index] = { ...updated[index], boil_time_min: boilTime };
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
  const spicesByType = useMemo(() => {
    const groups: Record<string, SpiceCatalogItem[]> = {};
    spiceCatalog.forEach((spice) => {
      const type = spice.type || "other";
      if (!groups[type]) groups[type] = [];
      groups[type].push(spice);
    });
    return groups;
  }, [spiceCatalog]);

  // Filter out already-added
  const availableSpices = useMemo(() => {
    const addedIds = new Set(items.map((item) => item.spice_id));
    return spiceCatalog.filter((s) => !addedIds.has(s.id));
  }, [spiceCatalog, items]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Spices &amp; Herbs</h3>
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || isLoading}
              className="gap-1"
            >
              <Plus className="h-4 w-4" />
              Add Spice
              <ChevronsUpDown className="h-3 w-3 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[400px] p-0" align="end">
            <Command>
              <CommandInput
                placeholder="Search spices..."
                value={searchValue}
                onValueChange={setSearchValue}
              />
              <CommandList>
                <CommandEmpty>No spices found.</CommandEmpty>
                {Object.entries(spicesByType).map(([type, spices]) => {
                  const available = spices.filter((s) =>
                    availableSpices.some((as) => as.id === s.id)
                  );
                  if (available.length === 0) return null;

                  return (
                    <CommandGroup key={type} heading={TYPE_LABELS[type] || type}>
                      {available.map((spice) => (
                        <CommandItem
                          key={spice.id}
                          value={spice.name}
                          onSelect={() => handleAdd(spice)}
                          className="flex items-center justify-between"
                        >
                          <div className="flex flex-col">
                            <span>{spice.name}</span>
                            {spice.typical_amount && (
                              <span className="text-xs text-muted-foreground">
                                Typical: {spice.typical_amount} {spice.typical_unit}
                              </span>
                            )}
                          </div>
                          {items.some((item) => item.spice_id === spice.id) && (
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
          <p>No spices or herbs added yet.</p>
          <p className="text-sm mt-1">Click &quot;Add Spice&quot; to add coriander, orange peel, etc.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Spice/Herb</TableHead>
              <TableHead className="w-20 text-right">Amount</TableHead>
              <TableHead className="w-20">Unit</TableHead>
              <TableHead className="w-28">Timing</TableHead>
              <TableHead className="w-20">Time</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => {
              const spice = item.spice || spiceCatalog.find((s) => s.id === item.spice_id);

              return (
                <TableRow key={item.spice_id}>
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
                      <span className="font-medium">{spice?.name || "Unknown"}</span>
                      <Badge variant="outline" className="text-xs">
                        {spice?.type}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      step="0.1"
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
                        handleUnitChange(index, value as SpiceItem["unit"])
                      }
                      disabled={disabled}
                    >
                      <SelectTrigger className="w-16">
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
                        handleTimingChange(index, value as SpiceItem["timing"])
                      }
                      disabled={disabled}
                    >
                      <SelectTrigger className="w-24">
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
                    {item.timing === "boil" ? (
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          step="1"
                          min="0"
                          value={item.boil_time_min || ""}
                          onChange={(e) =>
                            handleBoilTimeChange(index, parseInt(e.target.value) || 0)
                          }
                          disabled={disabled}
                          className="w-14 text-right"
                        />
                        <span className="text-xs text-muted-foreground">min</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
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
        </Table>
      )}
    </div>
  );
}
