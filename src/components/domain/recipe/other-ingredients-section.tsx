"use client";

/**
 * OtherIngredientsSection - Tabbed section for adjuncts, sugars, spices, and fruits.
 *
 * Each tab fetches from its junction table, manages local state with dirty tracking,
 * and saves via delete-all + insert-new pattern.
 * View mode = read-only tables; Edit mode = interactive with add/remove and save.
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys, catalogKeys } from "@/lib/query-keys";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useRegisterSaver } from "@/components/domain/recipe/recipe-editor/recipe-editor-context";
import { Plus, Trash2, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { unwrap } from "@/lib/supabase/query-helpers";

// =============================================================================
// Types
// =============================================================================

type CatalogItem = {
  id: string;
  name: string;
  type: string | null;
}

type AdjunctCatalogItem = CatalogItem & {
  potential_ppg: number | null;
}

type FruitCatalogItem = CatalogItem & {
  form: string | null;
}

type BaseIngredientRow = {
  id?: string;
  position: number;
  timing: string | null;
  notes: string | null;
}

type AdjunctRow = BaseIngredientRow & {
  adjunct_id: string;
  weight_lbs: number;
  adjunct?: AdjunctCatalogItem;
}

type SugarRow = BaseIngredientRow & {
  sugar_id: string;
  weight_lbs: number;
  sugar?: CatalogItem;
}

type SpiceRow = BaseIngredientRow & {
  spice_id: string;
  amount: number;
  unit: string;
  boil_time_min: number | null;
  spice?: CatalogItem;
}

type FruitRow = BaseIngredientRow & {
  fruit_id: string;
  amount: number;
  unit: string;
  fruit?: FruitCatalogItem;
}

// =============================================================================
// Timing options shared across all ingredient types
// =============================================================================

const TIMING_OPTIONS = [
  { value: "mash", label: "Mash" },
  { value: "boil", label: "Boil" },
  { value: "whirlpool", label: "Whirlpool" },
  { value: "primary", label: "Primary" },
  { value: "secondary", label: "Secondary" },
  { value: "packaging", label: "Packaging" },
];

// =============================================================================
// Main Component
// =============================================================================

type OtherIngredientsSectionProps = {
  data: { id: string };
  editing?: boolean;
}

export function OtherIngredientsSection({
  data,
  editing,
}: OtherIngredientsSectionProps) {
  const recipeId = data.id;

  return (
    <Tabs defaultValue="adjuncts">
      <TabsList>
        <TabsTrigger value="adjuncts">Adjuncts</TabsTrigger>
        <TabsTrigger value="sugars">Sugars</TabsTrigger>
        <TabsTrigger value="spices">Spices</TabsTrigger>
        <TabsTrigger value="fruits">Fruits</TabsTrigger>
      </TabsList>

      <TabsContent value="adjuncts">
        <AdjunctsTab recipeId={recipeId} editing={editing} />
      </TabsContent>
      <TabsContent value="sugars">
        <SugarsTab recipeId={recipeId} editing={editing} />
      </TabsContent>
      <TabsContent value="spices">
        <SpicesTab recipeId={recipeId} editing={editing} />
      </TabsContent>
      <TabsContent value="fruits">
        <FruitsTab recipeId={recipeId} editing={editing} />
      </TabsContent>
    </Tabs>
  );
}

// =============================================================================
// Catalog Selector (shared)
// =============================================================================

function CatalogSelector({
  label,
  items,
  loading,
  onSelect,
  disabled,
}: {
  label: string;
  items: CatalogItem[];
  loading: boolean;
  onSelect: (item: CatalogItem) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || loading}
          className="gap-1"
        >
          <Plus className="h-4 w-4" />
          Add {label}
          <ChevronsUpDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="end">
        <Command>
          <CommandInput
            placeholder={`Search ${label.toLowerCase()}...`}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No items found.</CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.name}
                  onSelect={() => {
                    onSelect(item);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  <div className="flex flex-col">
                    <span>{item.name}</span>
                    {item.type && (
                      <span className="text-xs text-muted-foreground">
                        {item.type}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// =============================================================================
// Adjuncts Tab
// =============================================================================

function AdjunctsTab({
  recipeId,
  editing,
}: {
  recipeId: string;
  editing?: boolean;
}) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const [items, setItems] = useState<AdjunctRow[]>([]);
  const [dirty, setDirty] = useState(false);

  const { data: catalog = [], isLoading: catalogLoading } =
    useCatalog<AdjunctCatalogItem>(
      catalogKeys.adjuncts(),
      "adjuncts",
      "id, name, type, potential_ppg",
      ["type", "name"]
    );

  const { data: fetched, isLoading } = useQuery({
    queryKey: recipeKeys.adjuncts(recipeId),
    queryFn: async () => {
      return await unwrap(
        supabase
          .from("recipe_adjuncts")
          .select("id, adjunct_id, weight_lbs, timing, notes, position, adjuncts (id, name, type, potential_ppg)")
          .eq("recipe_id", recipeId)
          .order("position", { ascending: true })
      );
    },
  });

  const [prev, setPrev] = useState(fetched);
  if (fetched && fetched !== prev) {
    setPrev(fetched);
    setItems(
      fetched.map((r) => ({
        id: r.id,
        adjunct_id: r.adjunct_id,
        weight_lbs: r.weight_lbs,
        timing: r.timing,
        notes: r.notes,
        position: r.position ?? 0,
        adjunct: r.adjuncts,
      }))
    );
    setDirty(false);
  }

  const save = useMutation({
    mutationFn: async () => {
      await unwrap(
        supabase
          .from("recipe_adjuncts")
          .delete()
          .eq("recipe_id", recipeId)
      );
      if (items.length > 0) {
        await unwrap(
          supabase.from("recipe_adjuncts").insert(
            items.map((item, i) => ({
              recipe_id: recipeId,
              adjunct_id: item.adjunct_id,
              weight_lbs: item.weight_lbs,
              timing: item.timing,
              notes: item.notes,
              position: i,
            }))
          )
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recipeKeys.adjuncts(recipeId) });
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipeId) });
      setDirty(false);
    },
    onError: (e) => toast.error("Failed to save adjuncts: " + e.message),
  });

  useRegisterSaver("adjuncts", Boolean(editing && dirty), useCallback(async () => {
    if (!dirty) return;
    await save.mutateAsync();
  }, [dirty, save]));

  const addItem = useCallback(
    (cat: CatalogItem) => {
      if (items.some((i) => i.adjunct_id === cat.id)) return;
      setItems((prev) => [
        ...prev,
        {
          adjunct_id: cat.id,
          weight_lbs: 0,
          timing: "boil",
          notes: null,
          position: prev.length,
          adjunct: cat as AdjunctCatalogItem,
        },
      ]);
      setDirty(true);
    },
    [items]
  );

  const updateItem = useCallback(
    (index: number, field: string, value: unknown) => {
      setItems((prev) => {
        const updated = [...prev];
        updated[index] = { ...updated[index], [field]: value };
        return updated;
      });
      setDirty(true);
    },
    []
  );

  const removeItem = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  }, []);

  if (isLoading) return <Skeleton className="h-24 w-full" />;

  const availableCatalog = catalog.filter(
    (c) => !items.some((i) => i.adjunct_id === c.id)
  );

  return (
    <div className="space-y-4 pt-4">
      {editing && (
        <div className="flex justify-end">
          <CatalogSelector
            label="Adjunct"
            items={availableCatalog}
            loading={catalogLoading}
            onSelect={addItem}
            disabled={save.isPending}
          />
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No adjuncts added.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Adjunct</TableHead>
              <TableHead className="w-28 text-right">Weight (lbs)</TableHead>
              <TableHead className="w-28">Timing</TableHead>
              {editing && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => {
              const name =
                item.adjunct?.name ??
                catalog.find((c) => c.id === item.adjunct_id)?.name ??
                "Unknown";
              return (
                <TableRow key={item.adjunct_id}>
                  <TableCell className="font-medium">{name}</TableCell>
                  <TableCell className="text-right">
                    {editing ? (
                      <Input
                        type="number"
                        step="0.25"
                        min="0"
                        value={item.weight_lbs || ""}
                        onChange={(e) =>
                          updateItem(index, "weight_lbs", parseFloat(e.target.value) || 0)
                        }
                        className="w-24 text-right ml-auto"
                      />
                    ) : (
                      item.weight_lbs || "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {editing ? (
                      <TimingSelect
                        value={item.timing}
                        onChange={(v) => updateItem(index, "timing", v)}
                      />
                    ) : (
                      TIMING_OPTIONS.find((t) => t.value === item.timing)?.label ??
                      item.timing ??
                      "—"
                    )}
                  </TableCell>
                  {editing && (
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem(index)}
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
        </Table>
      )}

    </div>
  );
}

// =============================================================================
// Sugars Tab
// =============================================================================

function SugarsTab({
  recipeId,
  editing,
}: {
  recipeId: string;
  editing?: boolean;
}) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const [items, setItems] = useState<SugarRow[]>([]);
  const [dirty, setDirty] = useState(false);

  const { data: catalog = [], isLoading: catalogLoading } =
    useCatalog<CatalogItem>(
      catalogKeys.sugars(),
      "sugars",
      "id, name, type",
      ["type", "name"]
    );

  const { data: fetched, isLoading } = useQuery({
    queryKey: recipeKeys.sugars(recipeId),
    queryFn: async () => {
      return await unwrap(
        supabase
          .from("recipe_sugars")
          .select("id, sugar_id, weight_lbs, timing, notes, position, sugars (id, name, type)")
          .eq("recipe_id", recipeId)
          .order("position", { ascending: true })
      );
    },
  });

  const [prev, setPrev] = useState(fetched);
  if (fetched && fetched !== prev) {
    setPrev(fetched);
    setItems(
      fetched.map((r) => ({
        id: r.id,
        sugar_id: r.sugar_id,
        weight_lbs: r.weight_lbs,
        timing: r.timing,
        notes: r.notes,
        position: r.position ?? 0,
        sugar: r.sugars,
      }))
    );
    setDirty(false);
  }

  const save = useMutation({
    mutationFn: async () => {
      await unwrap(
        supabase
          .from("recipe_sugars")
          .delete()
          .eq("recipe_id", recipeId)
      );
      if (items.length > 0) {
        await unwrap(
          supabase.from("recipe_sugars").insert(
            items.map((item, i) => ({
              recipe_id: recipeId,
              sugar_id: item.sugar_id,
              weight_lbs: item.weight_lbs,
              timing: item.timing,
              notes: item.notes,
              position: i,
            }))
          )
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recipeKeys.sugars(recipeId) });
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipeId) });
      setDirty(false);
    },
    onError: (e) => toast.error("Failed to save sugars: " + e.message),
  });

  useRegisterSaver("sugars", Boolean(editing && dirty), useCallback(async () => {
    if (!dirty) return;
    await save.mutateAsync();
  }, [dirty, save]));

  const addItem = useCallback(
    (cat: CatalogItem) => {
      if (items.some((i) => i.sugar_id === cat.id)) return;
      setItems((prev) => [
        ...prev,
        {
          sugar_id: cat.id,
          weight_lbs: 0,
          timing: "boil",
          notes: null,
          position: prev.length,
          sugar: cat,
        },
      ]);
      setDirty(true);
    },
    [items]
  );

  const updateItem = useCallback(
    (index: number, field: string, value: unknown) => {
      setItems((prev) => {
        const updated = [...prev];
        updated[index] = { ...updated[index], [field]: value };
        return updated;
      });
      setDirty(true);
    },
    []
  );

  const removeItem = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  }, []);

  if (isLoading) return <Skeleton className="h-24 w-full" />;

  const availableCatalog = catalog.filter(
    (c) => !items.some((i) => i.sugar_id === c.id)
  );

  return (
    <div className="space-y-4 pt-4">
      {editing && (
        <div className="flex justify-end">
          <CatalogSelector
            label="Sugar"
            items={availableCatalog}
            loading={catalogLoading}
            onSelect={addItem}
            disabled={save.isPending}
          />
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No sugars added.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sugar</TableHead>
              <TableHead className="w-28 text-right">Weight (lbs)</TableHead>
              <TableHead className="w-28">Timing</TableHead>
              {editing && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => {
              const name =
                item.sugar?.name ??
                catalog.find((c) => c.id === item.sugar_id)?.name ??
                "Unknown";
              return (
                <TableRow key={item.sugar_id}>
                  <TableCell className="font-medium">{name}</TableCell>
                  <TableCell className="text-right">
                    {editing ? (
                      <Input
                        type="number"
                        step="0.25"
                        min="0"
                        value={item.weight_lbs || ""}
                        onChange={(e) =>
                          updateItem(index, "weight_lbs", parseFloat(e.target.value) || 0)
                        }
                        className="w-24 text-right ml-auto"
                      />
                    ) : (
                      item.weight_lbs || "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {editing ? (
                      <TimingSelect
                        value={item.timing}
                        onChange={(v) => updateItem(index, "timing", v)}
                      />
                    ) : (
                      TIMING_OPTIONS.find((t) => t.value === item.timing)?.label ??
                      item.timing ??
                      "—"
                    )}
                  </TableCell>
                  {editing && (
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem(index)}
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
        </Table>
      )}

    </div>
  );
}

// =============================================================================
// Spices Tab
// =============================================================================

function SpicesTab({
  recipeId,
  editing,
}: {
  recipeId: string;
  editing?: boolean;
}) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const [items, setItems] = useState<SpiceRow[]>([]);
  const [dirty, setDirty] = useState(false);

  const { data: catalog = [], isLoading: catalogLoading } =
    useCatalog<CatalogItem>(
      catalogKeys.spices(),
      "spices",
      "id, name, type",
      ["type", "name"]
    );

  const { data: fetched, isLoading } = useQuery({
    queryKey: recipeKeys.spices(recipeId),
    queryFn: async () => {
      return await unwrap(
        supabase
          .from("recipe_spices")
          .select("id, spice_id, amount, unit, timing, boil_time_min, notes, position, spices (id, name, type)")
          .eq("recipe_id", recipeId)
          .order("position", { ascending: true })
      );
    },
  });

  const [prev, setPrev] = useState(fetched);
  if (fetched && fetched !== prev) {
    setPrev(fetched);
    setItems(
      fetched.map((r) => ({
        id: r.id,
        spice_id: r.spice_id,
        amount: r.amount,
        unit: r.unit,
        timing: r.timing,
        boil_time_min: r.boil_time_min,
        notes: r.notes,
        position: r.position ?? 0,
        spice: r.spices,
      }))
    );
    setDirty(false);
  }

  const save = useMutation({
    mutationFn: async () => {
      await unwrap(
        supabase
          .from("recipe_spices")
          .delete()
          .eq("recipe_id", recipeId)
      );
      if (items.length > 0) {
        await unwrap(
          supabase.from("recipe_spices").insert(
            items.map((item, i) => ({
              recipe_id: recipeId,
              spice_id: item.spice_id,
              amount: item.amount,
              unit: item.unit,
              timing: item.timing,
              boil_time_min: item.boil_time_min,
              notes: item.notes,
              position: i,
            }))
          )
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recipeKeys.spices(recipeId) });
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipeId) });
      setDirty(false);
    },
    onError: (e) => toast.error("Failed to save spices: " + e.message),
  });

  useRegisterSaver("spices", Boolean(editing && dirty), useCallback(async () => {
    if (!dirty) return;
    await save.mutateAsync();
  }, [dirty, save]));

  const addItem = useCallback(
    (cat: CatalogItem) => {
      if (items.some((i) => i.spice_id === cat.id)) return;
      setItems((prev) => [
        ...prev,
        {
          spice_id: cat.id,
          amount: 0,
          unit: "oz",
          timing: "boil",
          boil_time_min: 5,
          notes: null,
          position: prev.length,
          spice: cat,
        },
      ]);
      setDirty(true);
    },
    [items]
  );

  const updateItem = useCallback(
    (index: number, field: string, value: unknown) => {
      setItems((prev) => {
        const updated = [...prev];
        updated[index] = { ...updated[index], [field]: value };
        return updated;
      });
      setDirty(true);
    },
    []
  );

  const removeItem = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  }, []);

  if (isLoading) return <Skeleton className="h-24 w-full" />;

  const availableCatalog = catalog.filter(
    (c) => !items.some((i) => i.spice_id === c.id)
  );

  return (
    <div className="space-y-4 pt-4">
      {editing && (
        <div className="flex justify-end">
          <CatalogSelector
            label="Spice"
            items={availableCatalog}
            loading={catalogLoading}
            onSelect={addItem}
            disabled={save.isPending}
          />
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No spices added.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Spice</TableHead>
              <TableHead className="w-20 text-right">Amount</TableHead>
              <TableHead className="w-20">Unit</TableHead>
              <TableHead className="w-28">Timing</TableHead>
              <TableHead className="w-24 text-right">Boil (min)</TableHead>
              {editing && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => {
              const name =
                item.spice?.name ??
                catalog.find((c) => c.id === item.spice_id)?.name ??
                "Unknown";
              return (
                <TableRow key={item.spice_id}>
                  <TableCell className="font-medium">{name}</TableCell>
                  <TableCell className="text-right">
                    {editing ? (
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        value={item.amount || ""}
                        onChange={(e) =>
                          updateItem(index, "amount", parseFloat(e.target.value) || 0)
                        }
                        className="w-20 text-right"
                      />
                    ) : (
                      item.amount || "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {editing ? (
                      <UnitSelect
                        value={item.unit}
                        onChange={(v) => updateItem(index, "unit", v)}
                      />
                    ) : (
                      item.unit
                    )}
                  </TableCell>
                  <TableCell>
                    {editing ? (
                      <TimingSelect
                        value={item.timing}
                        onChange={(v) => updateItem(index, "timing", v)}
                      />
                    ) : (
                      TIMING_OPTIONS.find((t) => t.value === item.timing)?.label ??
                      item.timing ??
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {editing ? (
                      <Input
                        type="number"
                        min="0"
                        value={item.boil_time_min ?? ""}
                        onChange={(e) =>
                          updateItem(
                            index,
                            "boil_time_min",
                            e.target.value ? parseInt(e.target.value) : null
                          )
                        }
                        className="w-20 text-right"
                      />
                    ) : (
                      item.boil_time_min ?? "—"
                    )}
                  </TableCell>
                  {editing && (
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem(index)}
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
        </Table>
      )}

    </div>
  );
}

// =============================================================================
// Fruits Tab
// =============================================================================

function FruitsTab({
  recipeId,
  editing,
}: {
  recipeId: string;
  editing?: boolean;
}) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const [items, setItems] = useState<FruitRow[]>([]);
  const [dirty, setDirty] = useState(false);

  const { data: catalog = [], isLoading: catalogLoading } =
    useCatalog<FruitCatalogItem>(
      catalogKeys.fruits(),
      "fruits",
      "id, name, type, form",
      ["type", "name"]
    );

  const { data: fetched, isLoading } = useQuery({
    queryKey: recipeKeys.fruits(recipeId),
    queryFn: async () => {
      return await unwrap(
        supabase
          .from("recipe_fruits")
          .select("id, fruit_id, amount, unit, timing, notes, position, fruits (id, name, type, form)")
          .eq("recipe_id", recipeId)
          .order("position", { ascending: true })
      );
    },
  });

  const [prev, setPrev] = useState(fetched);
  if (fetched && fetched !== prev) {
    setPrev(fetched);
    setItems(
      fetched.map((r) => ({
        id: r.id,
        fruit_id: r.fruit_id,
        amount: r.amount,
        unit: r.unit,
        timing: r.timing,
        notes: r.notes,
        position: r.position ?? 0,
        fruit: r.fruits,
      }))
    );
    setDirty(false);
  }

  const save = useMutation({
    mutationFn: async () => {
      await unwrap(
        supabase
          .from("recipe_fruits")
          .delete()
          .eq("recipe_id", recipeId)
      );
      if (items.length > 0) {
        await unwrap(
          supabase.from("recipe_fruits").insert(
            items.map((item, i) => ({
              recipe_id: recipeId,
              fruit_id: item.fruit_id,
              amount: item.amount,
              unit: item.unit,
              timing: item.timing,
              notes: item.notes,
              position: i,
            }))
          )
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recipeKeys.fruits(recipeId) });
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipeId) });
      setDirty(false);
    },
    onError: (e) => toast.error("Failed to save fruits: " + e.message),
  });

  useRegisterSaver("fruits", Boolean(editing && dirty), useCallback(async () => {
    if (!dirty) return;
    await save.mutateAsync();
  }, [dirty, save]));

  const addItem = useCallback(
    (cat: CatalogItem) => {
      if (items.some((i) => i.fruit_id === cat.id)) return;
      setItems((prev) => [
        ...prev,
        {
          fruit_id: cat.id,
          amount: 0,
          unit: "lbs",
          timing: "secondary",
          notes: null,
          position: prev.length,
          fruit: cat as FruitCatalogItem,
        },
      ]);
      setDirty(true);
    },
    [items]
  );

  const updateItem = useCallback(
    (index: number, field: string, value: unknown) => {
      setItems((prev) => {
        const updated = [...prev];
        updated[index] = { ...updated[index], [field]: value };
        return updated;
      });
      setDirty(true);
    },
    []
  );

  const removeItem = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  }, []);

  if (isLoading) return <Skeleton className="h-24 w-full" />;

  const availableCatalog = catalog.filter(
    (c) => !items.some((i) => i.fruit_id === c.id)
  );

  return (
    <div className="space-y-4 pt-4">
      {editing && (
        <div className="flex justify-end">
          <CatalogSelector
            label="Fruit"
            items={availableCatalog}
            loading={catalogLoading}
            onSelect={addItem}
            disabled={save.isPending}
          />
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No fruits added.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fruit</TableHead>
              <TableHead className="w-20 text-right">Amount</TableHead>
              <TableHead className="w-20">Unit</TableHead>
              <TableHead className="w-28">Timing</TableHead>
              {editing && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => {
              const fruit =
                item.fruit ?? (catalog.find((c) => c.id === item.fruit_id) as FruitCatalogItem | undefined);
              return (
                <TableRow key={item.fruit_id}>
                  <TableCell>
                    <div>
                      <span className="font-medium">{fruit?.name ?? "Unknown"}</span>
                      {fruit?.form && (
                        <span className="text-xs text-muted-foreground ml-2">
                          ({fruit.form})
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {editing ? (
                      <Input
                        type="number"
                        step="0.25"
                        min="0"
                        value={item.amount || ""}
                        onChange={(e) =>
                          updateItem(index, "amount", parseFloat(e.target.value) || 0)
                        }
                        className="w-20 text-right"
                      />
                    ) : (
                      item.amount || "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {editing ? (
                      <UnitSelect
                        value={item.unit}
                        onChange={(v) => updateItem(index, "unit", v)}
                      />
                    ) : (
                      item.unit
                    )}
                  </TableCell>
                  <TableCell>
                    {editing ? (
                      <TimingSelect
                        value={item.timing}
                        onChange={(v) => updateItem(index, "timing", v)}
                      />
                    ) : (
                      TIMING_OPTIONS.find((t) => t.value === item.timing)?.label ??
                      item.timing ??
                      "—"
                    )}
                  </TableCell>
                  {editing && (
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem(index)}
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
        </Table>
      )}

    </div>
  );
}

// =============================================================================
// Shared Small Components
// =============================================================================

function TimingSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value ?? "boil"} onValueChange={onChange}>
      <SelectTrigger className="w-28 h-8">
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
  );
}

const UNIT_OPTIONS = ["oz", "g", "lbs", "kg", "ml", "each"];

function UnitSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-20 h-8">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {UNIT_OPTIONS.map((u) => (
          <SelectItem key={u} value={u}>
            {u}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

