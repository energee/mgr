"use client";

/**
 * RecipeVariantEditor - Manage split/variant recipes with unique additions
 *
 * Renders collapsible cards for each variant with inline editing of name,
 * description, planned volume, and addition tables (hops, adjuncts, fruits,
 * spices). All four addition tables share the column-spec-driven
 * AdditionSection (hops add a `days` column and non-nullable timing) and the
 * shared CatalogPicker. Uses the delete-all + insert save pattern for
 * consistency with other recipe editors.
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
import { CatalogPicker } from "@/components/domain/recipe/catalog-picker";
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
import { UnitDisplay, UnitInput } from "@/components/ui/unit-input";
import { useVolumeUnit } from "@/hooks/use-unit-preferences";
import { convertVolume, UNIT_LABELS } from "@/domain/units";
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

type VariantHopItem = {
  hop_id: string;
  hop_name?: string;
  weight_oz: number;
  timing: string;
  days: number | null;
  position: number;
}

type VariantAdjunctItem = {
  adjunct_id: string;
  adjunct_name?: string;
  amount: number;
  unit: string;
  timing: string | null;
  position: number;
}

type VariantFruitItem = {
  fruit_id: string;
  fruit_name?: string;
  amount: number;
  unit: string;
  timing: string | null;
  position: number;
}

type VariantSpiceItem = {
  spice_id: string;
  spice_name?: string;
  amount: number;
  unit: string;
  timing: string | null;
  position: number;
}

type AdditionItem =
  | VariantHopItem
  | VariantAdjunctItem
  | VariantFruitItem
  | VariantSpiceItem;

type AdditionType = "hops" | "adjuncts" | "fruits" | "spices";

/** Clone a variant with a modified addition array (hops, adjuncts, fruits, or spices). */
function withUpdatedAdditions(
  variant: VariantItem,
  type: AdditionType,
  updater: (items: AdditionItem[]) => AdditionItem[]
): VariantItem {
  return { ...variant, [type]: updater(variant[type]) };
}

/** Create a new empty addition item for the given type. */
function newAddition(
  type: AdditionType,
  catalog: SimpleAdditionCatalog,
  position: number
): AdditionItem {
  if (type === "hops") {
    return {
      hop_id: catalog.id,
      hop_name: catalog.name,
      weight_oz: 0,
      timing: "dry_hop",
      days: null,
      position,
    };
  }
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

type VariantItem = {
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

type CostData = {
  id: string;
  est_total_cost: number | null;
  est_cost_per_bbl: number | null;
}

type RecipeVariantEditorProps = {
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

/**
 * Declarative column spec for an addition table. Hops add a `days` column and
 * a non-nullable timing select; the simple additions share amount/unit/timing.
 */
type AdditionColumn =
  | {
      kind: "number";
      field: string;
      header: string;
      inputClass: string;
      step?: string;
      /** Nullable columns parse as int-or-null (e.g. days); others float-or-0. */
      nullable?: boolean;
      placeholder?: string;
    }
  | { kind: "unit"; header: string }
  | { kind: "timing"; header: string; allowNone: boolean };

const SIMPLE_ADDITION_COLUMNS: AdditionColumn[] = [
  {
    kind: "number",
    field: "amount",
    header: "Amount",
    step: "0.25",
    inputClass: "w-20 text-right",
  },
  { kind: "unit", header: "Unit" },
  { kind: "timing", header: "Timing", allowNone: true },
];

const HOP_ADDITION_COLUMNS: AdditionColumn[] = [
  {
    kind: "number",
    field: "weight_oz",
    header: "Oz",
    step: "0.25",
    inputClass: "w-20 text-right",
  },
  { kind: "timing", header: "Timing", allowNone: false },
  {
    kind: "number",
    field: "days",
    header: "Days",
    nullable: true,
    inputClass: "w-16 text-right",
    placeholder: "--",
  },
];

// ── Catalog types ───────────────────────────────────────────────────────────

type HopCatalogItem = {
  id: string;
  name: string;
  origin: string | null;
  alpha_acid_typical: number | null;
}

type SimpleAdditionCatalog = {
  id: string;
  name: string;
}

/**
 * Maps fetched Supabase rows for a simple addition type into the local state shape.
 * The `idField`, `nameField`, and `relationName` vary by type but the structure is identical.
 */
function mapSimpleAdditionRows(
  rows: Record<string, unknown>[],
  idField: string,
  nameField: string,
  relationName: string
): Record<string, unknown>[] {
  return [...rows]
    .sort((a, b) => (a.position as number) - (b.position as number))
    .map((row) => ({
      [idField]: row[idField] as string,
      [nameField]: (row[relationName] as { name: string } | null)?.name,
      amount: row.amount as number,
      unit: row.unit as string,
      timing: row.timing as string | null,
      position: row.position as number,
    }));
}

// ── Component ───────────────────────────────────────────────────────────────

export function RecipeVariantEditor({ data }: RecipeVariantEditorProps) {
  const recipeId = data.id;
  const supabase = createClient();
  const queryClient = useQueryClient();
  const volumeUnit = useVolumeUnit();
  const volumeLabel = UNIT_LABELS[volumeUnit];

  const [variants, setVariants] = useState<VariantItem[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [expandedVariants, setExpandedVariants] = useState<Set<number>>(
    new Set([0])
  );

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
      return rows;
    },
  });

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

  // Sync fetched -> local state
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
        adjuncts: mapSimpleAdditionRows(v.recipe_variant_adjuncts || [], "adjunct_id", "adjunct_name", "adjuncts") as unknown as VariantAdjunctItem[],
        fruits: mapSimpleAdditionRows(v.recipe_variant_fruits || [], "fruit_id", "fruit_name", "fruits") as unknown as VariantFruitItem[],
        spices: mapSimpleAdditionRows(v.recipe_variant_spices || [], "spice_id", "spice_name", "spices") as unknown as VariantSpiceItem[],
      }))
    );
    setIsDirty(false);
  }

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

  const saveMutation = useMutation({
    mutationFn: async (items: VariantItem[]) => {
      const client = createClient();

      // Delete all existing (cascade deletes additions)
      const { error: deleteError } = await client
        .from("recipe_variants")
        .delete()
        .eq("recipe_id", recipeId);
      if (deleteError) throw deleteError;

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

  const addAddition = useCallback(
    (
      variantIndex: number,
      type: AdditionType,
      item: SimpleAdditionCatalog
    ) => {
      setVariants((prev) => {
        const updated = [...prev];
        updated[variantIndex] = withUpdatedAdditions(
          updated[variantIndex],
          type,
          (items) => [...items, newAddition(type, item, items.length)]
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
      type: AdditionType,
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
      type: AdditionType,
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
                ? ({ ...item, [field]: value } as AdditionItem)
                : item
            )
        );
        return updated;
      });
      setIsDirty(true);
    },
    []
  );

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
                      <span><UnitDisplay value={variant.planned_volume_bbl} unitType="volume" decimals={1} /></span>
                    )}
                    {cost?.est_total_cost != null && (
                      <span>${cost.est_total_cost.toFixed(2)}</span>
                    )}
                    {cost?.est_cost_per_bbl != null && (
                      <span className="text-xs">
                        (${(cost.est_cost_per_bbl / convertVolume(1, "bbl", volumeUnit)).toFixed(2)}/{volumeLabel})
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
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label htmlFor={`variant-${vIndex}-volume`} className="text-sm font-medium">
                        Planned Volume
                      </label>
                      <UnitInput
                        id={`variant-${vIndex}-volume`}
                        value={variant.planned_volume_bbl ?? null}
                        onChange={(value) =>
                          updateVariantField(vIndex, "planned_volume_bbl", value)
                        }
                        unitType="volume"
                        decimals={1}
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

                  <AdditionSection
                    title="Hops"
                    icon={<Leaf className="h-4 w-4" />}
                    type="hops"
                    items={variant.hops}
                    catalog={hopCatalog}
                    variantIndex={vIndex}
                    onAdd={addAddition}
                    onRemove={removeAddition}
                    onUpdate={updateAddition}
                    nameField="hop_name"
                    nameHeader="Hop"
                    columns={HOP_ADDITION_COLUMNS}
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
                  />

                  <AdditionSection
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
                    columns={SIMPLE_ADDITION_COLUMNS}
                  />

                  <AdditionSection
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
                    columns={SIMPLE_ADDITION_COLUMNS}
                  />

                  <AdditionSection
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
                    columns={SIMPLE_ADDITION_COLUMNS}
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

// ── Addition section (hops, adjuncts, fruits, spices) ───────────────────────

/**
 * Column-spec-driven addition table for a variant: header with the shared
 * CatalogPicker, then one row per addition. Hops and the simple additions
 * (adjuncts/fruits/spices) differ only via the `columns` spec.
 */
function AdditionSection({
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
  nameHeader = "Name",
  columns,
  renderCatalogItem,
}: {
  title: string;
  icon: React.ReactNode;
  type: AdditionType;
  items: AdditionItem[];
  catalog: SimpleAdditionCatalog[];
  variantIndex: number;
  onAdd: (
    variantIndex: number,
    type: AdditionType,
    item: SimpleAdditionCatalog
  ) => void;
  onRemove: (
    variantIndex: number,
    type: AdditionType,
    index: number
  ) => void;
  onUpdate: (
    variantIndex: number,
    type: AdditionType,
    index: number,
    field: string,
    value: unknown
  ) => void;
  nameField: string;
  nameHeader?: string;
  columns: AdditionColumn[];
  renderCatalogItem?: (item: SimpleAdditionCatalog) => React.ReactNode;
}) {
  const tableHeaders = [nameHeader, ...columns.map((c) => c.header), ""];

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
        <CatalogPicker
          items={catalog}
          onSelect={(item) => onAdd(variantIndex, type, item)}
          searchPlaceholder={`Search ${title.toLowerCase()}...`}
          emptyMessage="No results found."
          renderItem={renderCatalogItem ?? ((item) => <span>{item.name}</span>)}
          trigger={
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
              <Plus className="h-3 w-3" />
              Add
              <ChevronsUpDown className="h-3 w-3 opacity-50" />
            </Button>
          }
        />
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          No {title.toLowerCase()} added.
        </p>
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
            {items.map((item, index) => {
              const row = item as AdditionItem & Record<string, unknown>;
              return (
                <TableRow key={index}>
                  <TableCell className="font-medium">
                    {(row[nameField] as string) || "Unknown"}
                  </TableCell>
                  {columns.map((col, cIndex) => (
                    <AdditionCell
                      key={cIndex}
                      col={col}
                      row={row}
                      onUpdate={(field, value) =>
                        onUpdate(variantIndex, type, index, field, value)
                      }
                    />
                  ))}
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
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/** Renders one declarative column cell of an addition row. */
function AdditionCell({
  col,
  row,
  onUpdate,
}: {
  col: AdditionColumn;
  row: Record<string, unknown>;
  onUpdate: (field: string, value: unknown) => void;
}) {
  if (col.kind === "number") {
    const value = row[col.field] as number | null;
    return (
      <TableCell>
        <Input
          type="number"
          step={col.step}
          min="0"
          value={col.nullable ? value ?? "" : value || ""}
          onChange={(e) =>
            onUpdate(
              col.field,
              col.nullable
                ? e.target.value
                  ? parseInt(e.target.value)
                  : null
                : parseFloat(e.target.value) || 0
            )
          }
          className={col.inputClass}
          placeholder={col.placeholder}
        />
      </TableCell>
    );
  }

  if (col.kind === "unit") {
    return (
      <TableCell>
        <Select
          value={(row.unit as string) || "oz"}
          onValueChange={(value) => onUpdate("unit", value)}
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
    );
  }

  // timing
  return (
    <TableCell>
      <Select
        value={
          col.allowNone
            ? ((row.timing as string | null) || "_none")
            : (row.timing as string)
        }
        onValueChange={(value) =>
          onUpdate("timing", col.allowNone && value === "_none" ? null : value)
        }
      >
        <SelectTrigger className="w-28 h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {col.allowNone && <SelectItem value="_none">None</SelectItem>}
          {TIMING_OPTIONS.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </TableCell>
  );
}
