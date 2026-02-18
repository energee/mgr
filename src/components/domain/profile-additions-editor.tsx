"use client";

/**
 * ProfileAdditionsEditor - Water Addition Profile Items Editor
 *
 * Custom section component for the water addition profile detail page.
 * Manages salt/acid items stored in `recipe_additions` where `profile_id`
 * matches the current profile. Only shows water_salt and acid type additives.
 *
 * Features:
 * - Fetches profile items from recipe_additions filtered by profile_id
 * - Command palette for adding additives (grouped: Water Salts, Acids)
 * - Table with amount, unit, timing, target, and delete columns
 * - Local state management with explicit "Save Additions" button
 * - Delete-all then re-insert save pattern
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useCatalog } from "@/hooks/use-catalog";
import { waterAdditionProfileKeys, catalogKeys } from "@/lib/query-keys";
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
import { Plus, Trash2, Check, ChevronsUpDown, Save, FlaskConical } from "lucide-react";
import { toast } from "sonner";

// =============================================================================
// Types
// =============================================================================

interface AdditiveCatalogItem {
  id: string;
  name: string;
  type: string;
  description: string | null;
  typical_amount: number | null;
  typical_unit: string | null;
}

interface ProfileAdditionItem {
  additive_id: string;
  amount: number;
  unit: string;
  timing: string;
  target: string | null;
  position: number;
  /** Resolved additive info (from catalog) */
  additive?: AdditiveCatalogItem;
}

interface ProfileAdditionsEditorProps {
  data: { id: string | null };
  editing?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const TIMING_OPTIONS = [
  { value: "mash", label: "Mash" },
  { value: "sparge", label: "Sparge" },
  { value: "boil", label: "Boil" },
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
] as const;

const TYPE_LABELS: Record<string, string> = {
  water_salt: "Water Salts",
  acid: "Acids",
};

/** Only water chemistry additive types are shown in profiles */
const PROFILE_ADDITIVE_TYPES = ["water_salt", "acid"];

// =============================================================================
// Component
// =============================================================================

export function ProfileAdditionsEditor({ data, editing }: ProfileAdditionsEditorProps) {
  const profileId = data.id;
  const supabase = createClient();
  const queryClient = useQueryClient();

  const [localItems, setLocalItems] = useState<ProfileAdditionItem[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  /** Fetch existing profile addition items */
  const { data: savedItems, isLoading: itemsLoading } = useQuery({
    queryKey: waterAdditionProfileKeys.items(profileId!),
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("recipe_additions")
        .select(`
          id,
          additive_id,
          amount,
          unit,
          timing,
          target,
          position,
          additive:additives (
            id,
            name,
            type,
            description,
            typical_amount,
            typical_unit
          )
        `)
        .eq("profile_id", profileId!)
        .order("position", { ascending: true });

      if (error) throw error;

      return (rows || []).map((row) => ({
        additive_id: row.additive_id,
        amount: row.amount,
        unit: row.unit,
        timing: row.timing,
        target: row.target,
        position: row.position ?? 0,
        additive: row.additive as unknown as AdditiveCatalogItem | undefined,
      }));
    },
    enabled: !!profileId,
  });

  /** Fetch additives catalog, filtered to water_salt and acid types */
  const { data: additiveCatalog = [], isLoading: catalogLoading } =
    useCatalog<AdditiveCatalogItem>(
      catalogKeys.additives(),
      "additives",
      "id, name, type, description, typical_amount, typical_unit",
      ["type", "name"]
    );

  /** Filtered catalog: only water salts and acids */
  const filteredCatalog = useMemo(
    () => additiveCatalog.filter((a) => PROFILE_ADDITIVE_TYPES.includes(a.type)),
    [additiveCatalog]
  );

  // Sync fetched data to local editable state (React recommended pattern:
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders)
  const [prevSavedItems, setPrevSavedItems] = useState(savedItems);
  if (savedItems && savedItems !== prevSavedItems) {
    setPrevSavedItems(savedItems);
    setLocalItems(savedItems);
    setHasChanges(false);
  }

  // ---------------------------------------------------------------------------
  // Save mutation (delete-all + re-insert)
  // ---------------------------------------------------------------------------

  const saveMutation = useMutation({
    mutationFn: async (items: ProfileAdditionItem[]) => {
      // Step 1: Delete all existing items for this profile
      const { error: deleteError } = await supabase
        .from("recipe_additions")
        .delete()
        .eq("profile_id", profileId!);

      if (deleteError) throw deleteError;

      // Step 2: Insert new items
      if (items.length > 0) {
        const rows = items.map((item, index) => ({
          profile_id: profileId!,
          additive_id: item.additive_id,
          amount: item.amount,
          unit: item.unit,
          timing: item.timing,
          target: item.target,
          position: index,
        }));

        const { error: insertError } = await supabase
          .from("recipe_additions")
          .insert(rows);

        if (insertError) throw insertError;
      }
    },
    onSuccess: () => {
      setHasChanges(false);
      queryClient.invalidateQueries({
        queryKey: waterAdditionProfileKeys.items(profileId!),
      });
      toast.success("Additions saved");
    },
    onError: (error) => {
      toast.error(`Failed to save additions: ${error.message}`);
    },
  });

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleAdd = useCallback(
    (additive: AdditiveCatalogItem) => {
      // Prevent duplicates
      if (localItems.some((item) => item.additive_id === additive.id)) {
        setAddOpen(false);
        return;
      }

      const defaultTiming = additive.type === "acid" ? "mash" : "mash";

      const newItem: ProfileAdditionItem = {
        additive_id: additive.id,
        amount: additive.typical_amount || 0,
        unit: additive.typical_unit || "g",
        timing: defaultTiming,
        target: "mash",
        position: localItems.length,
        additive,
      };

      setLocalItems((prev) => [...prev, newItem]);
      setHasChanges(true);
      setAddOpen(false);
      setSearchValue("");
    },
    [localItems]
  );

  const handleAmountChange = useCallback((index: number, amount: number) => {
    setLocalItems((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], amount };
      return updated;
    });
    setHasChanges(true);
  }, []);

  const handleUnitChange = useCallback((index: number, unit: string) => {
    setLocalItems((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], unit };
      return updated;
    });
    setHasChanges(true);
  }, []);

  const handleTimingChange = useCallback((index: number, timing: string) => {
    setLocalItems((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], timing };
      return updated;
    });
    setHasChanges(true);
  }, []);

  const handleTargetChange = useCallback((index: number, target: string) => {
    setLocalItems((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], target };
      return updated;
    });
    setHasChanges(true);
  }, []);

  const handleRemove = useCallback((index: number) => {
    setLocalItems((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      return updated.map((item, i) => ({ ...item, position: i }));
    });
    setHasChanges(true);
  }, []);

  const handleSave = useCallback(() => {
    saveMutation.mutate(localItems);
  }, [saveMutation, localItems]);

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  /** Group additives by type for the command palette */
  const additivesByType = useMemo(() => {
    const groups: Record<string, AdditiveCatalogItem[]> = {};
    filteredCatalog.forEach((add) => {
      const type = add.type || "other";
      if (!groups[type]) groups[type] = [];
      groups[type].push(add);
    });
    return groups;
  }, [filteredCatalog]);

  /** Additives not yet added */
  const availableAdditives = useMemo(() => {
    const addedIds = new Set(localItems.map((item) => item.additive_id));
    return filteredCatalog.filter((add) => !addedIds.has(add.id));
  }, [filteredCatalog, localItems]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Show "save the profile first" when no profile ID yet (create mode)
  if (!profileId) {
    return (
      <div className="text-center text-muted-foreground py-6">
        <FlaskConical className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p>Save the profile first to add additions</p>
      </div>
    );
  }

  if (itemsLoading || catalogLoading) {
    return (
      <div className="space-y-2 py-4">
        <div className="h-10 bg-muted animate-pulse rounded" />
        <div className="h-10 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  const isDisabled = !editing;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {hasChanges && (
            <Button
              variant="default"
              size="sm"
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="gap-1"
            >
              <Save className="h-4 w-4" />
              {saveMutation.isPending ? "Saving..." : "Save Additions"}
            </Button>
          )}
        </div>
        {!isDisabled && (
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
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
                  placeholder="Search water salts and acids..."
                  value={searchValue}
                  onValueChange={setSearchValue}
                />
                <CommandList>
                  <CommandEmpty>No additives found.</CommandEmpty>
                  {Object.entries(additivesByType).map(([type, additives]) => {
                    const available = additives.filter((a) =>
                      availableAdditives.some((aa) => aa.id === a.id)
                    );
                    if (available.length === 0) return null;

                    return (
                      <CommandGroup key={type} heading={TYPE_LABELS[type] || type}>
                        {available.map((additive) => (
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
                            {localItems.some((item) => item.additive_id === additive.id) && (
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
        )}
      </div>

      {localItems.length === 0 ? (
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          <FlaskConical className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>No additions added yet.</p>
          <p className="text-sm mt-1">
            Click &quot;Add Addition&quot; to add water salts and acids.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Additive</TableHead>
              <TableHead className="w-24 text-right">Amount</TableHead>
              <TableHead className="w-20">Unit</TableHead>
              <TableHead className="w-28">Timing</TableHead>
              <TableHead className="w-28">Target</TableHead>
              {!isDisabled && <TableHead className="w-16" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {localItems.map((item, index) => {
              const additive =
                item.additive || filteredCatalog.find((a) => a.id === item.additive_id);

              return (
                <TableRow key={item.additive_id}>
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
                    {isDisabled ? (
                      <span className="font-mono">{item.amount}</span>
                    ) : (
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        value={item.amount || ""}
                        onChange={(e) =>
                          handleAmountChange(index, parseFloat(e.target.value) || 0)
                        }
                        className="w-20 text-right ml-auto"
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    {isDisabled ? (
                      <span>{item.unit}</span>
                    ) : (
                      <Select
                        value={item.unit}
                        onValueChange={(value) => handleUnitChange(index, value)}
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
                    )}
                  </TableCell>
                  <TableCell>
                    {isDisabled ? (
                      <span className="capitalize">{item.timing}</span>
                    ) : (
                      <Select
                        value={item.timing}
                        onValueChange={(value) => handleTimingChange(index, value)}
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
                    )}
                  </TableCell>
                  <TableCell>
                    {isDisabled ? (
                      <span>
                        {item.target
                          ? TARGET_OPTIONS.find((o) => o.value === item.target)?.label || item.target
                          : "—"}
                      </span>
                    ) : (
                      <Select
                        value={item.target || "mash"}
                        onValueChange={(value) => handleTargetChange(index, value)}
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
                    )}
                  </TableCell>
                  {!isDisabled && (
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemove(index)}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={isDisabled ? 5 : 6} className="text-sm text-muted-foreground">
                {localItems.length} addition{localItems.length !== 1 ? "s" : ""}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </div>
  );
}
