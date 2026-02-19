"use client";

/**
 * AdditionsEditor - Recipe Additions Management Component
 *
 * General-purpose editor for managing recipe additions (clarifiers, nutrients, etc.).
 * Water salts and acids are typically managed via water addition profiles; use the
 * `excludeTypes` prop to filter them from the catalog on recipe pages.
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
import { Plus, Trash2, GripVertical, ChevronsUpDown } from "lucide-react";
import { catalogKeys } from "@/lib/query-keys";

export interface AdditionItem {
  id?: string;
  additive_id: string;
  amount: number;
  unit: string;
  timing: string;
  target?: string;
  position: number;
  additive?: {
    id: string;
    name: string;
    type: string;
    description: string | null;
    typical_amount: number | null;
    typical_unit: string | null;
  };
}

interface AdditiveCatalogItem {
  id: string;
  name: string;
  type: string;
  description: string | null;
  typical_amount: number | null;
  typical_unit: string | null;
}

interface AdditionsEditorProps {
  items: AdditionItem[];
  onChange: (items: AdditionItem[]) => void;
  disabled?: boolean;
  /** Additive types to exclude from the catalog (e.g. ["water_salt", "acid"]) */
  excludeTypes?: string[];
}

const TIMING_OPTIONS = [
  { value: "mash", label: "Mash" },
  { value: "sparge", label: "Sparge" },
  { value: "boil", label: "Boil" },
  { value: "whirlpool", label: "Whirlpool" },
  { value: "fermentation", label: "Fermentation" },
  { value: "packaging", label: "Packaging" },
] as const;

const TARGET_OPTIONS = [
  { value: "mash", label: "Mash Water" },
  { value: "sparge", label: "Sparge Water" },
  { value: "kettle", label: "Kettle" },
] as const;

const UNIT_OPTIONS = [
  { value: "g", label: "grams" },
  { value: "oz", label: "oz" },
  { value: "tsp", label: "tsp" },
  { value: "tbsp", label: "tbsp" },
  { value: "ml", label: "mL" },
  { value: "tablets", label: "tablets" },
] as const;

const TYPE_LABELS: Record<string, string> = {
  water_salt: "Water Salts",
  acid: "Acids",
  clarifier: "Clarifiers",
  nutrient: "Nutrients",
  enzyme: "Enzymes",
  antifoam: "Antifoam",
  other: "Other",
};

/** Additive types that need target selection (mash/sparge/kettle) */
const WATER_CHEMISTRY_TYPES = ["water_salt", "acid"];

export function AdditionsEditor({
  items,
  onChange,
  disabled = false,
  excludeTypes = [],
}: AdditionsEditorProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  const { data: rawCatalog = [], isLoading } = useCatalog<AdditiveCatalogItem>(catalogKeys.additives(), "additives", "id, name, type, description, typical_amount, typical_unit", ["type", "name"]);

  const additiveCatalog = useMemo(
    () =>
      excludeTypes.length > 0
        ? rawCatalog.filter((a) => !excludeTypes.includes(a.type))
        : rawCatalog,
    [rawCatalog, excludeTypes]
  );

  const handleAdd = useCallback(
    (additive: AdditiveCatalogItem) => {
      if (items.some((item) => item.additive_id === additive.id)) {
        setAddOpen(false);
        return;
      }

      let defaultTiming = "boil";
      if (additive.type === "water_salt" || additive.type === "acid") {
        defaultTiming = "mash";
      } else if (additive.type === "nutrient") {
        defaultTiming = "fermentation";
      }

      const newItem: AdditionItem = {
        additive_id: additive.id,
        amount: additive.typical_amount || 0,
        unit: additive.typical_unit || "g",
        timing: defaultTiming,
        target: WATER_CHEMISTRY_TYPES.includes(additive.type) ? "mash" : undefined,
        position: items.length,
        additive: additive,
      };

      onChange([...items, newItem]);
      setAddOpen(false);
      setSearchValue("");
    },
    [items, onChange]
  );

  const handleFieldChange = useCallback(
    (index: number, field: keyof AdditionItem, value: string | number) => {
      const updated = [...items];
      updated[index] = { ...updated[index], [field]: value };
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

  /** Available (not-yet-added) additives grouped by type for the selector */
  const availableByType = useMemo(() => {
    const addedIds = new Set(items.map((item) => item.additive_id));
    const groups: Record<string, AdditiveCatalogItem[]> = {};
    for (const add of additiveCatalog) {
      if (addedIds.has(add.id)) continue;
      const type = add.type || "other";
      if (!groups[type]) groups[type] = [];
      groups[type].push(add);
    }
    return groups;
  }, [additiveCatalog, items]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Additions</h3>
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || isLoading}
              className="gap-1"
            >
              <Plus className="h-4 w-4" />
              Add Addition
              <ChevronsUpDown className="h-3 w-3 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[400px] p-0" align="end">
            <Command>
              <CommandInput
                placeholder="Search additives..."
                value={searchValue}
                onValueChange={setSearchValue}
              />
              <CommandList>
                <CommandEmpty>No additives found.</CommandEmpty>
                {Object.entries(availableByType).map(([type, additives]) => (
                  <CommandGroup key={type} heading={TYPE_LABELS[type] || type}>
                    {additives.map((additive) => (
                      <CommandItem
                        key={additive.id}
                        value={additive.name}
                        onSelect={() => handleAdd(additive)}
                        className="flex items-center justify-between"
                      >
                        <div className="flex flex-col">
                          <span>{additive.name}</span>
                          {additive.description && (
                            <span className="text-xs text-muted-foreground line-clamp-1">
                              {additive.description}
                            </span>
                          )}
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
          <p>No additions added yet.</p>
          <p className="text-sm mt-1">
            Click &quot;Add Addition&quot; to add water salts, clarifiers, nutrients, etc.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Additive</TableHead>
              <TableHead className="w-24 text-right">Amount</TableHead>
              <TableHead className="w-20">Unit</TableHead>
              <TableHead className="w-28">Timing</TableHead>
              <TableHead className="w-28">Target</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => {
              const additive =
                item.additive || additiveCatalog.find((a) => a.id === item.additive_id);
              const showTarget = additive && WATER_CHEMISTRY_TYPES.includes(additive.type);

              return (
                <TableRow key={item.additive_id}>
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
                        <div className="font-medium">{additive?.name || "Unknown"}</div>
                        {additive?.description && (
                          <div className="text-xs text-muted-foreground line-clamp-1">
                            {additive.description}
                          </div>
                        )}
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {TYPE_LABELS[additive?.type || "other"] || additive?.type}
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
                        handleFieldChange(index, "amount", parseFloat(e.target.value) || 0)
                      }
                      disabled={disabled}
                      className="w-20 text-right ml-auto"
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={item.unit}
                      onValueChange={(value) => handleFieldChange(index, "unit", value)}
                      disabled={disabled}
                    >
                      <SelectTrigger className="w-20">
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
                      onValueChange={(value) => handleFieldChange(index, "timing", value)}
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
                    {showTarget ? (
                      <Select
                        value={item.target || "mash"}
                        onValueChange={(value) => handleFieldChange(index, "target", value)}
                        disabled={disabled}
                      >
                        <SelectTrigger className="w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TARGET_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
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
          <TableFooter>
            <TableRow>
              <TableCell colSpan={7} className="text-sm text-muted-foreground">
                {items.length} addition{items.length !== 1 ? "s" : ""}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </div>
  );
}
