"use client";

/**
 * HopScheduleEditor - Recipe Hop Schedule Management Component
 *
 * A specialized editor for managing recipe hops in junction table format.
 * Features:
 * - Searchable hop selector from catalog
 * - Timing selection (boil, whirlpool, dry hop)
 * - Boil time input for boil additions
 * - IBU contribution estimates
 * - Drag-to-reorder (position)
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, GripVertical, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { catalogKeys } from "@/lib/query-keys";

// Hop timing options
export const HOP_TIMINGS = [
  { value: "first_wort", label: "First Wort", description: "Added during lautering" },
  { value: "boil", label: "Boil", description: "Added during boil" },
  { value: "whirlpool", label: "Whirlpool", description: "Added at flameout/whirlpool" },
  { value: "dry_hop", label: "Dry Hop", description: "Added during fermentation" },
] as const;

export type HopTiming = (typeof HOP_TIMINGS)[number]["value"];

// Types for hop schedule entries
export interface HopScheduleItem {
  id?: string;
  hop_id: string;
  weight_oz: number;
  timing: HopTiming;
  boil_time_min: number | null;
  position: number;
  // Joined data (read-only)
  hop?: {
    id: string;
    name: string;
    origin: string | null;
    type: string | null;
    alpha_acid_typical: number | null;
    flavor_profile: string | null;
  };
}

interface HopCatalogItem {
  id: string;
  name: string;
  origin: string | null;
  type: string | null;
  alpha_acid_typical: number | null;
  flavor_profile: string | null;
}

interface HopScheduleEditorProps {
  /** Current hop schedule items */
  items: HopScheduleItem[];
  /** Callback when items change */
  onChange: (items: HopScheduleItem[]) => void;
  /** Whether the editor is disabled */
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
  const [addOpen, setAddOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  // Fetch hop catalog
  const { data: hopCatalog = [], isLoading: loadingHops } = useCatalog<HopCatalogItem>(catalogKeys.hops(), "hops", "id, name, origin, type, alpha_acid_typical, flavor_profile", ["type", "name"]);

  // Calculate IBU for a single hop addition (Tinseth formula)
  const calculateIBU = useCallback(
    (item: HopScheduleItem): number => {
      if (!item.hop?.alpha_acid_typical || !item.weight_oz) return 0;

      // Only boil and first wort contribute significant IBU
      if (item.timing === "dry_hop") return 0;
      if (item.timing === "whirlpool") {
        // Whirlpool contributes ~15-20% of a 20-min boil
        const utilization = 0.05;
        const aau = item.weight_oz * item.hop.alpha_acid_typical;
        return (aau * utilization * 74.89) / batchSizeGal;
      }

      const boilTime = item.timing === "first_wort" ? 60 : (item.boil_time_min || 0);
      if (boilTime <= 0) return 0;

      // Tinseth utilization formula
      const bigness = 1.65 * Math.pow(0.000125, estimatedOG - 1);
      const boilFactor = (1 - Math.exp(-0.04 * boilTime)) / 4.15;
      const utilization = bigness * boilFactor;

      // IBU = (AAU × Utilization × 74.89) / Gallons
      const aau = item.weight_oz * item.hop.alpha_acid_typical;
      return (aau * utilization * 74.89) / batchSizeGal;
    },
    [batchSizeGal, estimatedOG]
  );

  // Calculate totals
  const totals = useMemo(() => {
    const totalWeight = items.reduce((sum, item) => sum + (item.weight_oz || 0), 0);
    const totalIBU = items.reduce((sum, item) => sum + calculateIBU(item), 0);
    return { totalWeight, totalIBU };
  }, [items, calculateIBU]);

  // Add a new hop to the schedule
  const handleAddHop = useCallback(
    (hop: HopCatalogItem) => {
      const newItem: HopScheduleItem = {
        hop_id: hop.id,
        weight_oz: 0,
        timing: "boil",
        boil_time_min: 60,
        position: items.length,
        hop: hop,
      };

      onChange([...items, newItem]);
      setAddOpen(false);
      setSearchValue("");
    },
    [items, onChange]
  );

  // Update a field for an item
  const handleFieldChange = useCallback(
    (index: number, field: keyof HopScheduleItem, value: unknown) => {
      const updated = [...items];
      updated[index] = { ...updated[index], [field]: value };

      // Clear boil time if timing is not boil
      if (field === "timing" && value !== "boil" && value !== "first_wort") {
        updated[index].boil_time_min = null;
      }
      // Set default boil time when switching to boil
      if (field === "timing" && value === "boil" && !updated[index].boil_time_min) {
        updated[index].boil_time_min = 60;
      }

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

  // Group hops by type for the selector
  const hopsByType = useMemo(() => {
    const groups: Record<string, HopCatalogItem[]> = {};
    hopCatalog.forEach((hop) => {
      const type = hop.type || "dual";
      if (!groups[type]) groups[type] = [];
      groups[type].push(hop);
    });
    return groups;
  }, [hopCatalog]);

  // Type labels for display
  const typeLabels: Record<string, string> = {
    bittering: "Bittering Hops",
    aroma: "Aroma Hops",
    dual: "Dual Purpose",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Hop Schedule</h3>
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || loadingHops}
              className="gap-1"
            >
              <Plus className="h-4 w-4" />
              Add Hop
              <ChevronsUpDown className="h-3 w-3 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[400px] p-0" align="end">
            <Command>
              <CommandInput
                placeholder="Search hops..."
                value={searchValue}
                onValueChange={setSearchValue}
              />
              <CommandList>
                <CommandEmpty>No hops found.</CommandEmpty>
                {Object.entries(hopsByType).map(([type, hops]) => (
                  <CommandGroup key={type} heading={typeLabels[type] || type}>
                    {hops.map((hop) => (
                      <CommandItem
                        key={hop.id}
                        value={`${hop.name} ${hop.origin || ""}`}
                        onSelect={() => handleAddHop(hop)}
                        className="flex items-center justify-between"
                      >
                        <div className="flex flex-col">
                          <span>{hop.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {hop.origin}
                            {hop.alpha_acid_typical && ` • ${hop.alpha_acid_typical}% AA`}
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
          <p>No hops added yet.</p>
          <p className="text-sm mt-1">Click &quot;Add Hop&quot; to build your hop schedule.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Hop</TableHead>
              <TableHead className="w-28">Timing</TableHead>
              <TableHead className="w-20 text-right">Time</TableHead>
              <TableHead className="w-20 text-right">Oz</TableHead>
              <TableHead className="w-16 text-right">AA%</TableHead>
              <TableHead className="w-16 text-right">IBU</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => {
              const hop = item.hop || hopCatalog.find((h) => h.id === item.hop_id);
              const ibu = calculateIBU(item);

              return (
                <TableRow key={`${item.hop_id}-${index}`}>
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
                        <div className="font-medium">{hop?.name || "Unknown"}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {hop?.flavor_profile}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={item.timing}
                      onValueChange={(value) =>
                        handleFieldChange(index, "timing", value as HopTiming)
                      }
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
                          handleFieldChange(
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
                        {item.timing === "first_wort" && "60 min"}
                        {item.timing === "whirlpool" && "0 min"}
                        {item.timing === "dry_hop" && "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      step="0.25"
                      min="0"
                      value={item.weight_oz || ""}
                      onChange={(e) =>
                        handleFieldChange(
                          index,
                          "weight_oz",
                          parseFloat(e.target.value) || 0
                        )
                      }
                      disabled={disabled}
                      className="w-16 text-right"
                    />
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {hop?.alpha_acid_typical?.toFixed(1) || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <span
                      className={cn(
                        "tabular-nums",
                        ibu > 0 && "font-medium"
                      )}
                    >
                      {ibu > 0 ? ibu.toFixed(1) : "—"}
                    </span>
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
              <TableCell colSpan={4} className="font-medium">
                Total
              </TableCell>
              <TableCell className="text-right font-medium">
                {totals.totalWeight.toFixed(2)} oz
              </TableCell>
              <TableCell></TableCell>
              <TableCell className="text-right font-medium">
                {totals.totalIBU.toFixed(0)} IBU
              </TableCell>
              <TableCell></TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}

      {/* Legend for timings */}
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
