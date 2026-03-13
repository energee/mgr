"use client";

/**
 * HopScheduleEditor - Recipe Hop Schedule Management Component
 *
 * Manages recipe hops in junction table format with searchable selector,
 * timing/boil-time inputs, IBU estimates (Tinseth), and drag-to-reorder.
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

export interface HopScheduleItem {
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

interface HopCatalogItem {
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

interface HopScheduleEditorProps {
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
  const [addOpen, setAddOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  const { data: hopCatalog = [], isLoading: loadingHops } = useCatalog<HopCatalogItem>(catalogKeys.hops(), "hops", "id, name, origin, type, alpha_acid_typical, flavor_profile, bag_weight_lbs", ["type", "name"]);

  /** IBU contribution for a single hop addition (Tinseth formula) */
  const calculateIBU = useCallback(
    (item: HopScheduleItem): number => {
      if (!item.hop?.alpha_acid_typical || !item.weight_oz) return 0;

      if (item.timing === "dry_hop") return 0;
      if (item.timing === "whirlpool") {
        const utilization = 0.05; // ~15-20% of a 20-min boil
        const aau = item.weight_oz * item.hop.alpha_acid_typical;
        return (aau * utilization * 74.89) / batchSizeGal;
      }

      const boilTime = item.timing === "first_wort" ? 60 : (item.boil_time_min || 0);
      if (boilTime <= 0) return 0;

      const bigness = 1.65 * Math.pow(0.000125, estimatedOG - 1);
      const boilFactor = (1 - Math.exp(-0.04 * boilTime)) / 4.15;
      const utilization = bigness * boilFactor;
      const aau = item.weight_oz * item.hop.alpha_acid_typical;
      return (aau * utilization * 74.89) / batchSizeGal;
    },
    [batchSizeGal, estimatedOG]
  );

  const totals = useMemo(() => ({
    totalWeight: items.reduce((sum, item) => sum + (item.weight_oz || 0), 0),
    totalIBU: items.reduce((sum, item) => sum + calculateIBU(item), 0),
  }), [items, calculateIBU]);

  const handleAddHop = useCallback(
    (hop: HopCatalogItem) => {
      const newItem: HopScheduleItem = {
        id: crypto.randomUUID(),
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

  const handleFieldChange = useCallback(
    (index: number, field: keyof HopScheduleItem, value: unknown) => {
      const updated = [...items];
      updated[index] = { ...updated[index], [field]: value };

      if (field === "timing" && value !== "boil" && value !== "first_wort") {
        updated[index].boil_time_min = null;
      }
      if (field === "timing" && value === "boil" && !updated[index].boil_time_min) {
        updated[index].boil_time_min = 60;
      }

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
    (reordered: HopScheduleItem[]) => {
      const updated = reordered.map((item, i) => ({
        ...item,
        position: i,
      }));
      onChange(updated);
    },
    [onChange]
  );

  /** Hops grouped by type for the selector */
  const hopsByType = useMemo(() => {
    const groups: Record<string, HopCatalogItem[]> = {};
    for (const hop of hopCatalog) {
      const type = hop.type || "dual";
      if (!groups[type]) groups[type] = [];
      groups[type].push(hop);
    }
    return groups;
  }, [hopCatalog]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
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
                  <CommandGroup key={type} heading={HOP_TYPE_LABELS[type] || type}>
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
        <Sortable
          value={items}
          onValueChange={handleReorder}
          getItemValue={(item) => item.id!}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Hop</TableHead>
                <TableHead className="w-28">Timing</TableHead>
                <TableHead className="w-20 text-right">Time</TableHead>
                <TableHead className="w-20 text-right">Lbs</TableHead>
                <TableHead className="w-16 text-right">Bags</TableHead>
                <TableHead className="w-16 text-right">AA%</TableHead>
                <TableHead className="w-16 text-right">IBU</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <SortableContent asChild>
              <TableBody>
                {items.map((item, index) => {
                  const hop = item.hop || hopCatalog.find((h) => h.id === item.hop_id);
                  const ibu = calculateIBU(item);

                  return (
                    <SortableItem key={item.id} value={item.id!} asChild disabled={disabled}>
                      <TableRow>
                        <TableCell>
                          <SortableItemHandle className="p-1 hover:bg-muted rounded touch-none">
                            <GripVertical className="h-4 w-4 text-muted-foreground" />
                          </SortableItemHandle>
                        </TableCell>
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
                              handleFieldChange(
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
                    </SortableItem>
                  );
                })}
              </TableBody>
            </SortableContent>
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
          </Table>
          <SortableOverlay>
            {({ value }) => {
              const item = items.find((i) => i.id === value);
              const hop = item?.hop || hopCatalog.find((h) => h.id === item?.hop_id);
              return (
                <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 shadow-sm">
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{hop?.name || "Unknown"}</span>
                  {item && (
                    <span className="text-sm text-muted-foreground">
                      {HOP_TIMINGS.find((t) => t.value === item.timing)?.label}
                    </span>
                  )}
                </div>
              );
            }}
          </SortableOverlay>
        </Sortable>
      )}

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
