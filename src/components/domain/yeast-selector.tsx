"use client";

/**
 * YeastSelector - Recipe Yeast Management Component
 *
 * Manages recipe_yeasts junction table.
 * Features:
 * - Searchable yeast catalog
 * - Primary/secondary designation
 * - Pitch rate and fermentation temp
 * - Multiple yeast support (blends, Brett additions)
 */

import { useState, useMemo } from "react";
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
import { Switch } from "@/components/ui/switch";
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
import { Plus, Trash2 } from "lucide-react";
import { catalogKeys } from "@/lib/query-keys";

export interface YeastItem {
  id?: string;
  yeast_id: string;
  pitch_rate: number;
  fermentation_temp_f: number | null;
  is_primary: boolean;
  position: number;
  notes?: string;
  yeast?: {
    id: string;
    name: string;
    manufacturer: string | null;
    product_code: string | null;
    type: string;
    form: string;
    attenuation_typical: number | null;
    temp_min_f: number | null;
    temp_max_f: number | null;
    flocculation: string | null;
  };
}

interface YeastCatalogItem {
  id: string;
  name: string;
  manufacturer: string | null;
  product_code: string | null;
  type: string;
  form: string;
  attenuation_typical: number | null;
  temp_min_f: number | null;
  temp_max_f: number | null;
  flocculation: string | null;
}

interface YeastSelectorProps {
  items: YeastItem[];
  onChange: (items: YeastItem[]) => void;
  disabled?: boolean;
}

export function YeastSelector({
  items,
  onChange,
  disabled = false,
}: YeastSelectorProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  // Fetch yeast catalog
  const { data: yeastCatalog = [], isLoading: loadingYeasts } = useCatalog<YeastCatalogItem>(catalogKeys.yeasts(), "yeasts", "id, name, manufacturer, product_code, type, form, attenuation_typical, temp_min_f, temp_max_f, flocculation", ["manufacturer", "name"]);

  // Group by manufacturer
  const groupedYeasts = useMemo(() => {
    const groups: Record<string, YeastCatalogItem[]> = {};
    yeastCatalog.forEach((yeast) => {
      const key = yeast.manufacturer || "Other";
      if (!groups[key]) groups[key] = [];
      groups[key].push(yeast);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [yeastCatalog]);

  // Filter by search
  const filteredGroups = useMemo(() => {
    if (!searchValue) return groupedYeasts;
    const search = searchValue.toLowerCase();
    return groupedYeasts
      .map(([manufacturer, yeasts]) => [
        manufacturer,
        yeasts.filter(
          (y) =>
            y.name.toLowerCase().includes(search) ||
            y.product_code?.toLowerCase().includes(search) ||
            y.type.toLowerCase().includes(search)
        ),
      ] as [string, YeastCatalogItem[]])
      .filter(([, yeasts]) => yeasts.length > 0);
  }, [groupedYeasts, searchValue]);

  // Already selected yeast IDs
  const selectedIds = useMemo(
    () => new Set(items.map((item) => item.yeast_id)),
    [items]
  );

  // Add yeast
  const handleAdd = (yeast: YeastCatalogItem) => {
    const newItem: YeastItem = {
      yeast_id: yeast.id,
      pitch_rate: 0.75,
      fermentation_temp_f: yeast.temp_min_f
        ? Math.round((yeast.temp_min_f + (yeast.temp_max_f || yeast.temp_min_f)) / 2)
        : null,
      is_primary: items.length === 0, // First yeast is primary
      position: items.length,
      yeast: yeast,
    };
    onChange([...items, newItem]);
    setAddOpen(false);
    setSearchValue("");
  };

  // Remove yeast
  const handleRemove = (index: number) => {
    const newItems = items.filter((_, i) => i !== index);
    // Reposition and ensure at least one primary if any remain
    const repositioned = newItems.map((item, i) => ({
      ...item,
      position: i,
    }));
    // If no primary exists and there are items, make first one primary
    if (repositioned.length > 0 && !repositioned.some((i) => i.is_primary)) {
      repositioned[0].is_primary = true;
    }
    onChange(repositioned);
  };

  // Update field
  const handleUpdate = (
    index: number,
    field: keyof YeastItem,
    value: unknown
  ) => {
    const newItems = [...items];
    // If setting this as primary, unset others
    if (field === "is_primary" && value === true) {
      newItems.forEach((item, i) => {
        if (i !== index) item.is_primary = false;
      });
    }
    // Dynamic field assignment using Object.assign for type safety
    Object.assign(newItems[index], { [field]: value });
    onChange(newItems);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Yeast</h4>
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || loadingYeasts}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Yeast
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[400px] p-0" align="end">
            <Command>
              <CommandInput
                placeholder="Search yeasts..."
                value={searchValue}
                onValueChange={setSearchValue}
              />
              <CommandList>
                <CommandEmpty>No yeasts found.</CommandEmpty>
                {filteredGroups.map(([manufacturer, yeasts]) => (
                  <CommandGroup key={manufacturer} heading={manufacturer}>
                    {yeasts
                      .filter((y) => !selectedIds.has(y.id))
                      .map((yeast) => (
                        <CommandItem
                          key={yeast.id}
                          value={yeast.name}
                          onSelect={() => handleAdd(yeast)}
                          className="flex justify-between"
                        >
                          <div>
                            <span className="font-medium">{yeast.name}</span>
                            {yeast.product_code && (
                              <span className="text-muted-foreground ml-2">
                                {yeast.product_code}
                              </span>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Badge variant="outline" className="text-xs">
                              {yeast.type}
                            </Badge>
                            {yeast.attenuation_typical && (
                              <Badge variant="secondary" className="text-xs">
                                {yeast.attenuation_typical}%
                              </Badge>
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
        <div className="text-sm text-muted-foreground text-center py-4 border rounded-md border-dashed">
          No yeast selected. Add a yeast strain to start.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Yeast</TableHead>
              <TableHead className="w-[100px]">Pitch Rate</TableHead>
              <TableHead className="w-[100px]">Ferm Temp</TableHead>
              <TableHead className="w-[80px]">Primary</TableHead>
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => (
              <TableRow key={item.id || index}>
                <TableCell>
                  <div>
                    <div className="font-medium">
                      {item.yeast?.name || "Unknown"}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {item.yeast?.manufacturer}
                      {item.yeast?.product_code && ` • ${item.yeast.product_code}`}
                      {item.yeast?.attenuation_typical && (
                        <> • {item.yeast.attenuation_typical}% atten</>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    max="5"
                    value={item.pitch_rate}
                    onChange={(e) =>
                      handleUpdate(index, "pitch_rate", parseFloat(e.target.value) || 0)
                    }
                    disabled={disabled}
                    className="w-20"
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      step="1"
                      min={item.yeast?.temp_min_f || 50}
                      max={item.yeast?.temp_max_f || 90}
                      value={item.fermentation_temp_f || ""}
                      onChange={(e) =>
                        handleUpdate(
                          index,
                          "fermentation_temp_f",
                          e.target.value ? parseInt(e.target.value) : null
                        )
                      }
                      disabled={disabled}
                      className="w-16"
                    />
                    <span className="text-sm text-muted-foreground">°F</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Switch
                    checked={item.is_primary}
                    onCheckedChange={(checked) =>
                      handleUpdate(index, "is_primary", checked)
                    }
                    disabled={disabled}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove yeast"
                    onClick={() => handleRemove(index)}
                    disabled={disabled}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
