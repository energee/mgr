"use client";

/**
 * RecipeVariantEditor - Manage split/variant recipes with unique additions
 *
 * Renders collapsible cards for each variant with inline editing of name,
 * description, planned volume, and addition tables (hops, adjuncts, fruits,
 * spices). Uses the delete-all + insert save pattern for consistency with
 * other recipe editors.
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeVariantKeys, catalogKeys } from "@/lib/query-keys";
import { useCatalog } from "@/hooks/use-catalog";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Save,
  Leaf,
  Droplets,
  Cherry,
  Flame,
  Loader2,
  ChevronsUpDown,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

interface VariantHopItem {
  hop_id: string;
  hop_name?: string;
  weight_oz: number;
  timing: string;
  days: number | null;
  position: number;
}

interface VariantAdjunctItem {
  adjunct_id: string;
  adjunct_name?: string;
  amount: number;
  unit: string;
  timing: string | null;
  position: number;
}

interface VariantFruitItem {
  fruit_id: string;
  fruit_name?: string;
  amount: number;
  unit: string;
  timing: string | null;
  position: number;
}

interface VariantSpiceItem {
  spice_id: string;
  spice_name?: string;
  amount: number;
  unit: string;
  timing: string | null;
  position: number;
}

type SimpleAdditionItem = VariantAdjunctItem | VariantFruitItem | VariantSpiceItem;

type SimpleAdditionType = "adjuncts" | "fruits" | "spices";

/** Clone a variant with a modified simple-addition array (adjuncts, fruits, or spices). */
function withUpdatedAdditions(
  variant: VariantItem,
  type: SimpleAdditionType,
  updater: (items: SimpleAdditionItem[]) => SimpleAdditionItem[]
): VariantItem {
  return { ...variant, [type]: updater(variant[type]) };
}

/** Create a new empty addition item for the given type. */
function newSimpleAddition(
  type: SimpleAdditionType,
  catalog: SimpleAdditionCatalog,
  position: number
): SimpleAdditionItem {
  const base = { amount: 0, unit: "oz" as const, timing: null, position };
  switch (type) {
    case "adjuncts":
      return { adjunct_id: catalog.id, adjunct_name: catalog.name, ...base };
    case "fruits":
      return { fruit_id: catalog.id, fruit_name: catalog.name, ...base };
    case "spices":
      return { spice_id: catalog.id, spice_name: catalog.name, ...base };
  }
}

interface VariantItem {
  id?: string;
  name: string;
  description: string | null;
  position: number;
  planned_volume_bbl: number | null;
  hops: VariantHopItem[];
  adjuncts: VariantAdjunctItem[];
  fruits: VariantFruitItem[];
  spices: VariantSpiceItem[];
}

interface CostData {
  id: string;
  est_total_cost: number | null;
  est_cost_per_bbl: number | null;
}

interface RecipeVariantEditorProps {
  data: { id: string; [key: string]: unknown };
}

// ── Constants ───────────────────────────────────────────────────────────────

const TIMING_OPTIONS = [
  { value: "dry_hop", label: "Dry Hop" },
  { value: "secondary", label: "Secondary" },
  { value: "packaging", label: "Packaging" },
];

const UNIT_OPTIONS = [
  { value: "lbs", label: "lbs" },
  { value: "oz", label: "oz" },
  { value: "g", label: "g" },
  { value: "kg", label: "kg" },
  { value: "ml", label: "mL" },
  { value: "l", label: "L" },
  { value: "each", label: "each" },
];

// ── Catalog types ───────────────────────────────────────────────────────────

interface HopCatalogItem {
  id: string;
  name: string;
  origin: string | null;
  alpha_acid_typical: number | null;
}

interface SimpleAdditionCatalog {
  id: string;
  name: string;
}

// ── Component ───────────────────────────────────────────────────────────────

export function RecipeVariantEditor({ data }: RecipeVariantEditorProps) {
  const recipeId = data.id;
  const supabase = createClient();
  const queryClient = useQueryClient();

  const [variants, setVariants] = useState<VariantItem[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [expandedVariants, setExpandedVariants] = useState<Set<number>>(
    new Set([0])
  );

  // ── Fetch variants with additions ─────────────────────────────────────

  const { data: fetchedVariants, isLoading } = useQuery({
    queryKey: recipeVariantKeys.byRecipe(recipeId),
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("recipe_variants")
        .select(
          `
          id,
          name,
          description,
          position,
          planned_volume_bbl,
          recipe_variant_hops (
            hop_id,
            weight_oz,
            timing,
            days,
            position,
            hops ( name )
          ),
          recipe_variant_adjuncts (
            adjunct_id,
            amount,
            unit,
            timing,
            position,
            adjuncts ( name )
          ),
          recipe_variant_fruits (
            fruit_id,
            amount,
            unit,
            timing,
            position,
            fruits ( name )
          ),
          recipe_variant_spices (
            spice_id,
            amount,
            unit,
            timing,
            position,
            spices ( name )
          )
        `
        )
        .eq("recipe_id", recipeId)
        .order("position", { ascending: true });
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return rows as any[];
    },
  });

  // ── Fetch cost data ───────────────────────────────────────────────────

  const { data: costData } = useQuery({
    queryKey: recipeVariantKeys.withCosts(recipeId),
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("recipe_variants_with_costs")
        .select("id, est_total_cost, est_cost_per_bbl")
        .eq("recipe_id", recipeId);
      if (error) throw error;
      return rows as CostData[];
    },
  });

  const costMap = useMemo(() => {
    const map = new Map<string, CostData>();
    costData?.forEach((c) => map.set(c.id, c));
    return map;
  }, [costData]);

  // ── Sync fetched -> local state ───────────────────────────────────────

  const [prevFetched, setPrevFetched] = useState(fetchedVariants);
  if (fetchedVariants && fetchedVariants !== prevFetched) {
    setPrevFetched(fetchedVariants);
    setVariants(
      fetchedVariants.map((v) => ({
        id: v.id,
        name: v.name,
        description: v.description,
        position: v.position,
        planned_volume_bbl: v.planned_volume_bbl,
        hops: (v.recipe_variant_hops || [])
          .sort((a: VariantHopItem, b: VariantHopItem) => a.position - b.position)
          .map((h: Record<string, unknown>) => ({
            hop_id: h.hop_id as string,
            hop_name: (h.hops as { name: string } | null)?.name,
            weight_oz: h.weight_oz as number,
            timing: h.timing as string,
            days: h.days as number | null,
            position: h.position as number,
          })),
        adjuncts: (v.recipe_variant_adjuncts || [])
          .sort((a: VariantAdjunctItem, b: VariantAdjunctItem) => a.position - b.position)
          .map((a: Record<string, unknown>) => ({
            adjunct_id: a.adjunct_id as string,
            adjunct_name: (a.adjuncts as { name: string } | null)?.name,
            amount: a.amount as number,
            unit: a.unit as string,
            timing: a.timing as string | null,
            position: a.position as number,
          })),
        fruits: (v.recipe_variant_fruits || [])
          .sort((a: VariantFruitItem, b: VariantFruitItem) => a.position - b.position)
          .map((f: Record<string, unknown>) => ({
            fruit_id: f.fruit_id as string,
            fruit_name: (f.fruits as { name: string } | null)?.name,
            amount: f.amount as number,
            unit: f.unit as string,
            timing: f.timing as string | null,
            position: f.position as number,
          })),
        spices: (v.recipe_variant_spices || [])
          .sort((a: VariantSpiceItem, b: VariantSpiceItem) => a.position - b.position)
          .map((s: Record<string, unknown>) => ({
            spice_id: s.spice_id as string,
            spice_name: (s.spices as { name: string } | null)?.name,
            amount: s.amount as number,
            unit: s.unit as string,
            timing: s.timing as string | null,
            position: s.position as number,
          })),
      }))
    );
    setIsDirty(false);
  }

  // ── Fetch catalogs ────────────────────────────────────────────────────

  const { data: hopCatalog = [] } = useCatalog<HopCatalogItem>(
    catalogKeys.hops(),
    "hops",
    "id, name, origin, alpha_acid_typical",
    ["name"]
  );

  const { data: adjunctCatalog = [] } = useCatalog<SimpleAdditionCatalog>(
    catalogKeys.adjuncts(),
    "adjuncts",
    "id, name",
    ["name"]
  );

  const { data: fruitCatalog = [] } = useCatalog<SimpleAdditionCatalog>(
    catalogKeys.fruits(),
    "fruits",
    "id, name",
    ["name"]
  );

  const { data: spiceCatalog = [] } = useCatalog<SimpleAdditionCatalog>(
    catalogKeys.spices(),
    "spices",
    "id, name",
    ["name"]
  );

  // ── Mutation ──────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async (items: VariantItem[]) => {
      const client = createClient();

      // Delete all existing (cascade deletes additions)
      const { error: deleteError } = await client
        .from("recipe_variants")
        .delete()
        .eq("recipe_id", recipeId);
      if (deleteError) throw deleteError;

      // Insert each variant and its additions
      for (const [index, variant] of items.entries()) {
        const { data: inserted, error: insertError } = await client
          .from("recipe_variants")
          .insert({
            recipe_id: recipeId,
            name: variant.name,
            description: variant.description,
            position: index,
            planned_volume_bbl: variant.planned_volume_bbl,
          })
          .select("id")
          .single();
        if (insertError) throw insertError;
        if (!inserted) throw new Error("Failed to insert variant");

        // Insert hops
        if (variant.hops.length > 0) {
          const { error } = await client
            .from("recipe_variant_hops")
            .insert(
              variant.hops.map((h, i) => ({
                recipe_variant_id: inserted.id,
                hop_id: h.hop_id,
                weight_oz: h.weight_oz,
                timing: h.timing,
                days: h.days,
                position: i,
              }))
            );
          if (error) throw error;
        }

        // Insert adjuncts
        if (variant.adjuncts.length > 0) {
          const { error } = await client
            .from("recipe_variant_adjuncts")
            .insert(
              variant.adjuncts.map((a, i) => ({
                recipe_variant_id: inserted.id,
                adjunct_id: a.adjunct_id,
                amount: a.amount,
                unit: a.unit,
                timing: a.timing,
                position: i,
              }))
            );
          if (error) throw error;
        }

        // Insert fruits
        if (variant.fruits.length > 0) {
          const { error } = await client
            .from("recipe_variant_fruits")
            .insert(
              variant.fruits.map((f, i) => ({
                recipe_variant_id: inserted.id,
                fruit_id: f.fruit_id,
                amount: f.amount,
                unit: f.unit,
                timing: f.timing,
                position: i,
              }))
            );
          if (error) throw error;
        }

        // Insert spices
        if (variant.spices.length > 0) {
          const { error } = await client
            .from("recipe_variant_spices")
            .insert(
              variant.spices.map((s, i) => ({
                recipe_variant_id: inserted.id,
                spice_id: s.spice_id,
                amount: s.amount,
                unit: s.unit,
                timing: s.timing,
                position: i,
              }))
            );
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: recipeVariantKeys.byRecipe(recipeId),
      });
      queryClient.invalidateQueries({
        queryKey: recipeVariantKeys.withCosts(recipeId),
      });
      toast.success("Variants saved");
      setIsDirty(false);
    },
    onError: (error) => {
      toast.error("Failed to save variants: " + error.message);
    },
  });

  // ── Handlers: Variant-level ───────────────────────────────────────────

  const addVariant = useCallback(() => {
    const newVariant: VariantItem = {
      name: `Variant ${variants.length + 1}`,
      description: null,
      position: variants.length,
      planned_volume_bbl: null,
      hops: [],
      adjuncts: [],
      fruits: [],
      spices: [],
    };
    setVariants((prev) => [...prev, newVariant]);
    setExpandedVariants((prev) => new Set([...prev, variants.length]));
    setIsDirty(true);
  }, [variants.length]);

  const removeVariant = useCallback((index: number) => {
    setVariants((prev) => prev.filter((_, i) => i !== index));
    setIsDirty(true);
  }, []);

  const updateVariantField = useCallback(
    (index: number, field: keyof VariantItem, value: unknown) => {
      setVariants((prev) => {
        const updated = [...prev];
        updated[index] = { ...updated[index], [field]: value };
        return updated;
      });
      setIsDirty(true);
    },
    []
  );

  const toggleExpanded = useCallback((index: number) => {
    setExpandedVariants((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  // ── Handlers: Addition-level ──────────────────────────────────────────

  const addHop = useCallback(
    (variantIndex: number, hop: HopCatalogItem) => {
      setVariants((prev) => {
        const updated = [...prev];
        const variant = { ...updated[variantIndex] };
        variant.hops = [
          ...variant.hops,
          {
            hop_id: hop.id,
            hop_name: hop.name,
            weight_oz: 0,
            timing: "dry_hop",
            days: null,
            position: variant.hops.length,
          },
        ];
        updated[variantIndex] = variant;
        return updated;
      });
      setIsDirty(true);
    },
    []
  );

  const removeHop = useCallback(
    (variantIndex: number, hopIndex: number) => {
      setVariants((prev) => {
        const updated = [...prev];
        const variant = { ...updated[variantIndex] };
        variant.hops = variant.hops.filter((_, i) => i !== hopIndex);
        updated[variantIndex] = variant;
        return updated;
      });
      setIsDirty(true);
    },
    []
  );

  const updateHop = useCallback(
    (
      variantIndex: number,
      hopIndex: number,
      field: keyof VariantHopItem,
      value: unknown
    ) => {
      setVariants((prev) => {
        const updated = [...prev];
        const variant = { ...updated[variantIndex] };
        const hops = [...variant.hops];
        hops[hopIndex] = { ...hops[hopIndex], [field]: value };
        variant.hops = hops;
        updated[variantIndex] = variant;
        return updated;
      });
      setIsDirty(true);
    },
    []
  );

  const addAddition = useCallback(
    (
      variantIndex: number,
      type: SimpleAdditionType,
      item: SimpleAdditionCatalog
    ) => {
      setVariants((prev) => {
        const updated = [...prev];
        updated[variantIndex] = withUpdatedAdditions(
          updated[variantIndex],
          type,
          (items) => [...items, newSimpleAddition(type, item, items.length)]
        );
        return updated;
      });
      setIsDirty(true);
    },
    []
  );

  const removeAddition = useCallback(
    (
      variantIndex: number,
      type: SimpleAdditionType,
      additionIndex: number
    ) => {
      setVariants((prev) => {
        const updated = [...prev];
        updated[variantIndex] = withUpdatedAdditions(
          updated[variantIndex],
          type,
          (items) => items.filter((_, i) => i !== additionIndex)
        );
        return updated;
      });
      setIsDirty(true);
    },
    []
  );

  const updateAddition = useCallback(
    (
      variantIndex: number,
      type: SimpleAdditionType,
      additionIndex: number,
      field: string,
      value: unknown
    ) => {
      setVariants((prev) => {
        const updated = [...prev];
        updated[variantIndex] = withUpdatedAdditions(
          updated[variantIndex],
          type,
          (items) =>
            items.map((item, i) =>
              i === additionIndex
                ? ({ ...item, [field]: value } as SimpleAdditionItem)
                : item
            )
        );
        return updated;
      });
      setIsDirty(true);
    },
    []
  );

  // ── Render ────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {variants.length === 0
            ? "No variants defined. Add a variant to create split batches."
            : `${variants.length} variant${variants.length !== 1 ? "s" : ""}`}
        </p>
        <div className="flex items-center gap-2">
          {isDirty && (
            <Button
              type="button"
              size="sm"
              onClick={() => saveMutation.mutate(variants)}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Variants
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addVariant}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Variant
          </Button>
        </div>
      </div>

      {variants.map((variant, vIndex) => {
        const isExpanded = expandedVariants.has(vIndex);
        const cost = variant.id ? costMap.get(variant.id) : null;

        return (
          <Collapsible
            key={vIndex}
            open={isExpanded}
            onOpenChange={() => toggleExpanded(vIndex)}
          >
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                  <Input
                    value={variant.name}
                    onChange={(e) =>
                      updateVariantField(vIndex, "name", e.target.value)
                    }
                    className="h-8 font-semibold max-w-[200px]"
                    placeholder="Variant name"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    {variant.planned_volume_bbl != null && (
                      <span>{variant.planned_volume_bbl} BBL</span>
                    )}
                    {cost?.est_total_cost != null && (
                      <span>${cost.est_total_cost.toFixed(2)}</span>
                    )}
                    {cost?.est_cost_per_bbl != null && (
                      <span className="text-xs">
                        (${cost.est_cost_per_bbl.toFixed(2)}/BBL)
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeVariant(vIndex)}
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardHeader>

              <CollapsibleContent>
                <CardContent className="space-y-6">
                  {/* Basic Fields */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label htmlFor={`variant-${vIndex}-volume`} className="text-sm font-medium">
                        Planned Volume (BBL)
                      </label>
                      <Input
                        id={`variant-${vIndex}-volume`}
                        type="number"
                        step="0.5"
                        min="0"
                        value={variant.planned_volume_bbl ?? ""}
                        onChange={(e) =>
                          updateVariantField(
                            vIndex,
                            "planned_volume_bbl",
                            e.target.value
                              ? parseFloat(e.target.value)
                              : null
                          )
                        }
                        placeholder="e.g. 7"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor={`variant-${vIndex}-description`} className="text-sm font-medium">Description</label>
                      <Textarea
                        id={`variant-${vIndex}-description`}
                        value={variant.description ?? ""}
                        onChange={(e) =>
                          updateVariantField(
                            vIndex,
                            "description",
                            e.target.value || null
                          )
                        }
                        placeholder="Notes about this variant..."
                        rows={2}
                      />
                    </div>
                  </div>

                  {/* Hops Additions */}
                  <VariantAdditionSection
                    title="Hops"
                    icon={<Leaf className="h-4 w-4" />}
                    items={variant.hops}
                    catalog={hopCatalog}
                    searchPlaceholder="Search hops..."
                    emptyMessage="No hops added."
                    renderItem={(hop, hIndex) => (
                      <HopRow
                        key={hIndex}
                        hop={hop as VariantHopItem}
                        onUpdate={(field, value) =>
                          updateHop(vIndex, hIndex, field, value)
                        }
                        onRemove={() => removeHop(vIndex, hIndex)}
                      />
                    )}
                    onAdd={(item) => addHop(vIndex, item as HopCatalogItem)}
                    renderCatalogItem={(item) => {
                      const hop = item as HopCatalogItem;
                      return (
                        <div className="flex flex-col">
                          <span>{hop.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {hop.origin}
                            {hop.alpha_acid_typical &&
                              ` \u2022 ${hop.alpha_acid_typical}% AA`}
                          </span>
                        </div>
                      );
                    }}
                    tableHeaders={["Hop", "Oz", "Timing", "Days", ""]}
                  />

                  {/* Adjuncts */}
                  <SimpleAdditionSection
                    title="Adjuncts"
                    icon={<Droplets className="h-4 w-4" />}
                    type="adjuncts"
                    items={variant.adjuncts}
                    catalog={adjunctCatalog}
                    variantIndex={vIndex}
                    onAdd={addAddition}
                    onRemove={removeAddition}
                    onUpdate={updateAddition}
                    nameField="adjunct_name"
                  />

                  {/* Fruits */}
                  <SimpleAdditionSection
                    title="Fruits"
                    icon={<Cherry className="h-4 w-4" />}
                    type="fruits"
                    items={variant.fruits}
                    catalog={fruitCatalog}
                    variantIndex={vIndex}
                    onAdd={addAddition}
                    onRemove={removeAddition}
                    onUpdate={updateAddition}
                    nameField="fruit_name"
                  />

                  {/* Spices */}
                  <SimpleAdditionSection
                    title="Spices"
                    icon={<Flame className="h-4 w-4" />}
                    type="spices"
                    items={variant.spices}
                    catalog={spiceCatalog}
                    variantIndex={vIndex}
                    onAdd={addAddition}
                    onRemove={removeAddition}
                    onUpdate={updateAddition}
                    nameField="spice_name"
                  />
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        );
      })}
    </div>
  );
}

// ── Hop Row ─────────────────────────────────────────────────────────────────

function HopRow({
  hop,
  onUpdate,
  onRemove,
}: {
  hop: VariantHopItem;
  onUpdate: (field: keyof VariantHopItem, value: unknown) => void;
  onRemove: () => void;
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">{hop.hop_name || "Unknown"}</TableCell>
      <TableCell>
        <Input
          type="number"
          step="0.25"
          min="0"
          value={hop.weight_oz || ""}
          onChange={(e) =>
            onUpdate("weight_oz", parseFloat(e.target.value) || 0)
          }
          className="w-20 text-right"
        />
      </TableCell>
      <TableCell>
        <Select
          value={hop.timing}
          onValueChange={(value) => onUpdate("timing", value)}
        >
          <SelectTrigger className="w-28 h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMING_OPTIONS.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Input
          type="number"
          min="0"
          value={hop.days ?? ""}
          onChange={(e) =>
            onUpdate(
              "days",
              e.target.value ? parseInt(e.target.value) : null
            )
          }
          className="w-16 text-right"
          placeholder="--"
        />
      </TableCell>
      <TableCell>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

// ── Generic addition section with catalog selector ──────────────────────────

function VariantAdditionSection<T extends { id: string; name: string }>({
  title,
  icon,
  items,
  catalog,
  searchPlaceholder,
  emptyMessage,
  renderItem,
  onAdd,
  renderCatalogItem,
  tableHeaders,
}: {
  title: string;
  icon: React.ReactNode;
  items: unknown[];
  catalog: T[];
  searchPlaceholder: string;
  emptyMessage: string;
  renderItem: (item: unknown, index: number) => React.ReactNode;
  onAdd: (item: T) => void;
  renderCatalogItem: (item: T) => React.ReactNode;
  tableHeaders: string[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {title}
          {items.length > 0 && (
            <span className="text-muted-foreground">({items.length})</span>
          )}
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
              <Plus className="h-3 w-3" />
              Add
              <ChevronsUpDown className="h-3 w-3 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0" align="end">
            <Command>
              <CommandInput
                placeholder={searchPlaceholder}
                value={search}
                onValueChange={setSearch}
              />
              <CommandList>
                <CommandEmpty>No results found.</CommandEmpty>
                <CommandGroup>
                  {catalog.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.name}
                      onSelect={() => {
                        onAdd(item);
                        setOpen(false);
                        setSearch("");
                      }}
                    >
                      {renderCatalogItem(item)}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">{emptyMessage}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {tableHeaders.map((h, i) => (
                <TableHead key={i} className={i === 0 ? "" : "w-20"}>
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => renderItem(item, index))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ── Simple addition section (adjuncts, fruits, spices) ──────────────────────

function SimpleAdditionSection({
  title,
  icon,
  type,
  items,
  catalog,
  variantIndex,
  onAdd,
  onRemove,
  onUpdate,
  nameField,
}: {
  title: string;
  icon: React.ReactNode;
  type: SimpleAdditionType;
  items: SimpleAdditionItem[];
  catalog: SimpleAdditionCatalog[];
  variantIndex: number;
  onAdd: (
    variantIndex: number,
    type: SimpleAdditionType,
    item: SimpleAdditionCatalog
  ) => void;
  onRemove: (
    variantIndex: number,
    type: SimpleAdditionType,
    index: number
  ) => void;
  onUpdate: (
    variantIndex: number,
    type: SimpleAdditionType,
    index: number,
    field: string,
    value: unknown
  ) => void;
  nameField: string;
}) {
  return (
    <VariantAdditionSection
      title={title}
      icon={icon}
      items={items}
      catalog={catalog}
      searchPlaceholder={`Search ${title.toLowerCase()}...`}
      emptyMessage={`No ${title.toLowerCase()} added.`}
      tableHeaders={["Name", "Amount", "Unit", "Timing", ""]}
      onAdd={(item) => onAdd(variantIndex, type, item)}
      renderCatalogItem={(item) => <span>{item.name}</span>}
      renderItem={(item, index) => {
        const row = item as SimpleAdditionItem & Record<string, unknown>;
        return (
          <TableRow key={index}>
            <TableCell className="font-medium">
              {(row[nameField] as string) || "Unknown"}
            </TableCell>
            <TableCell>
              <Input
                type="number"
                step="0.25"
                min="0"
                value={row.amount || ""}
                onChange={(e) =>
                  onUpdate(
                    variantIndex,
                    type,
                    index,
                    "amount",
                    parseFloat(e.target.value) || 0
                  )
                }
                className="w-20 text-right"
              />
            </TableCell>
            <TableCell>
              <Select
                value={row.unit || "oz"}
                onValueChange={(value) =>
                  onUpdate(variantIndex, type, index, "unit", value)
                }
              >
                <SelectTrigger className="w-20 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNIT_OPTIONS.map((u) => (
                    <SelectItem key={u.value} value={u.value}>
                      {u.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </TableCell>
            <TableCell>
              <Select
                value={row.timing || "_none"}
                onValueChange={(value) =>
                  onUpdate(
                    variantIndex,
                    type,
                    index,
                    "timing",
                    value === "_none" ? null : value
                  )
                }
              >
                <SelectTrigger className="w-28 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">None</SelectItem>
                  {TIMING_OPTIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
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
                onClick={() => onRemove(variantIndex, type, index)}
                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TableCell>
          </TableRow>
        );
      }}
    />
  );
}
