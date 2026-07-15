"use client";

/**
 * OtherIngredientsSection - Tabbed section for adjuncts, sugars, spices, and fruits.
 *
 * All four tabs are instances of one generic IngredientTab driven by a
 * declarative spec ({ table, fkColumn, catalog, columns[] }). Each tab uses
 * useRecipeChildRows for fetch/dirty state and the aggregate atomic save.
 * View mode = read-only tables; Edit mode = interactive with add/remove and save.
 */

import { useCallback } from "react";
import { recipeKeys, catalogKeys } from "@/lib/query-keys";
import { useCatalog } from "@/hooks/use-catalog";
import { useRecipeChildRows } from "@/hooks/use-recipe-child-rows";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { CatalogPicker } from "@/components/domain/recipe/catalog-picker";
import {
  useRecipeEditor,
  useRegisterSaver,
  type RecipeChildSection,
} from "@/components/domain/recipe/recipe-editor/recipe-editor-context";
import { Plus, Trash2, ChevronsUpDown } from "lucide-react";

// =============================================================================
// Types
// =============================================================================

type CatalogItem = {
  id: string;
  name: string;
  type: string | null;
  /** Present on the fruits catalog only */
  form?: string | null;
}

/** Local row shape shared by all tabs; spec-specific fields are indexed. */
type IngredientRow = {
  id?: string;
  position: number;
  timing: string | null;
  notes: string | null;
  /** Joined catalog row from the fetch (or picked item on add) */
  catalogItem?: CatalogItem;
} & Record<string, unknown>;

/**
 * Declarative column spec for an ingredient table.
 * - number: numeric Input in edit mode; `nullable` columns parse as int-or-null
 *   (e.g. boil_time_min), others as float-or-0.
 * - unit / timing: shared Select components.
 */
type IngredientColumn =
  | {
      kind: "number";
      field: string;
      header: string;
      headClass: string;
      inputClass: string;
      step?: string;
      nullable?: boolean;
    }
  | { kind: "unit"; field: "unit"; header: string; headClass: string }
  | { kind: "timing"; field: "timing"; header: string; headClass: string };

/** Spec describing one ingredient tab (table, catalog, and columns). */
type IngredientTabSpec = {
  /** Saver registry id (also the tab's semantic name) */
  saverKey: string;
  /** Singular label for headers and the add button (e.g. "Adjunct") */
  label: string;
  /** Plural label for toasts (e.g. "adjuncts") */
  errorLabel: string;
  emptyMessage: string;
  /** Junction table (e.g. "recipe_adjuncts") */
  table: RecipeChildSection;
  /** FK column to the catalog table (e.g. "adjunct_id") */
  fkColumn: string;
  /** Joined relation name in the select (e.g. "adjuncts") */
  relation: string;
  /** Select string for fetching junction rows + joined catalog item */
  select: string;
  queryKey: (recipeId: string) => readonly unknown[];
  catalog: {
    queryKey: readonly unknown[];
    table: string;
    select: string;
  };
  /** Spec-specific fields copied between fetch/local/insert shapes */
  valueFields: string[];
  /** Defaults for a newly added row (fkColumn/position/catalogItem added) */
  newItemDefaults: Record<string, unknown>;
  columns: IngredientColumn[];
  /** Fruits: show the catalog item's form next to its name */
  showForm?: boolean;
};

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
// Tab specs
// =============================================================================

const CATALOG_ORDER = ["type", "name"];

const WEIGHT_COLUMN: IngredientColumn = {
  kind: "number",
  field: "weight_lbs",
  header: "Weight (lbs)",
  headClass: "w-28 text-right",
  inputClass: "w-24 text-right ml-auto",
  step: "0.25",
};

const TIMING_COLUMN: IngredientColumn = {
  kind: "timing",
  field: "timing",
  header: "Timing",
  headClass: "w-28",
};

const UNIT_COLUMN: IngredientColumn = {
  kind: "unit",
  field: "unit",
  header: "Unit",
  headClass: "w-20",
};

const ADJUNCTS_SPEC: IngredientTabSpec = {
  saverKey: "adjuncts",
  label: "Adjunct",
  errorLabel: "adjuncts",
  emptyMessage: "No adjuncts added.",
  table: "recipe_adjuncts",
  fkColumn: "adjunct_id",
  relation: "adjuncts",
  select:
    "id, adjunct_id, weight_lbs, timing, notes, position, adjuncts (id, name, type, potential_ppg)",
  queryKey: recipeKeys.adjuncts,
  catalog: {
    queryKey: catalogKeys.adjuncts(),
    table: "adjuncts",
    select: "id, name, type, potential_ppg",
  },
  valueFields: ["weight_lbs"],
  newItemDefaults: { weight_lbs: 0, timing: "boil", notes: null },
  columns: [WEIGHT_COLUMN, TIMING_COLUMN],
};

const SUGARS_SPEC: IngredientTabSpec = {
  saverKey: "sugars",
  label: "Sugar",
  errorLabel: "sugars",
  emptyMessage: "No sugars added.",
  table: "recipe_sugars",
  fkColumn: "sugar_id",
  relation: "sugars",
  select:
    "id, sugar_id, weight_lbs, timing, notes, position, sugars (id, name, type)",
  queryKey: recipeKeys.sugars,
  catalog: {
    queryKey: catalogKeys.sugars(),
    table: "sugars",
    select: "id, name, type",
  },
  valueFields: ["weight_lbs"],
  newItemDefaults: { weight_lbs: 0, timing: "boil", notes: null },
  columns: [WEIGHT_COLUMN, TIMING_COLUMN],
};

const SPICES_SPEC: IngredientTabSpec = {
  saverKey: "spices",
  label: "Spice",
  errorLabel: "spices",
  emptyMessage: "No spices added.",
  table: "recipe_spices",
  fkColumn: "spice_id",
  relation: "spices",
  select:
    "id, spice_id, amount, unit, timing, boil_time_min, notes, position, spices (id, name, type)",
  queryKey: recipeKeys.spices,
  catalog: {
    queryKey: catalogKeys.spices(),
    table: "spices",
    select: "id, name, type",
  },
  valueFields: ["amount", "unit", "boil_time_min"],
  newItemDefaults: {
    amount: 0,
    unit: "oz",
    timing: "boil",
    boil_time_min: 5,
    notes: null,
  },
  columns: [
    {
      kind: "number",
      field: "amount",
      header: "Amount",
      headClass: "w-20 text-right",
      inputClass: "w-20 text-right",
      step: "0.1",
    },
    UNIT_COLUMN,
    TIMING_COLUMN,
    {
      kind: "number",
      field: "boil_time_min",
      header: "Boil (min)",
      headClass: "w-24 text-right",
      inputClass: "w-20 text-right",
      nullable: true,
    },
  ],
};

const FRUITS_SPEC: IngredientTabSpec = {
  saverKey: "fruits",
  label: "Fruit",
  errorLabel: "fruits",
  emptyMessage: "No fruits added.",
  table: "recipe_fruits",
  fkColumn: "fruit_id",
  relation: "fruits",
  select:
    "id, fruit_id, amount, unit, timing, notes, position, fruits (id, name, type, form)",
  queryKey: recipeKeys.fruits,
  catalog: {
    queryKey: catalogKeys.fruits(),
    table: "fruits",
    select: "id, name, type, form",
  },
  valueFields: ["amount", "unit"],
  newItemDefaults: { amount: 0, unit: "lbs", timing: "secondary", notes: null },
  columns: [
    {
      kind: "number",
      field: "amount",
      header: "Amount",
      headClass: "w-20 text-right",
      inputClass: "w-20 text-right",
      step: "0.25",
    },
    UNIT_COLUMN,
    TIMING_COLUMN,
  ],
  showForm: true,
};

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
        <IngredientTab recipeId={recipeId} editing={editing} spec={ADJUNCTS_SPEC} />
      </TabsContent>
      <TabsContent value="sugars">
        <IngredientTab recipeId={recipeId} editing={editing} spec={SUGARS_SPEC} />
      </TabsContent>
      <TabsContent value="spices">
        <IngredientTab recipeId={recipeId} editing={editing} spec={SPICES_SPEC} />
      </TabsContent>
      <TabsContent value="fruits">
        <IngredientTab recipeId={recipeId} editing={editing} spec={FRUITS_SPEC} />
      </TabsContent>
    </Tabs>
  );
}

// =============================================================================
// Catalog Selector (shared picker trigger over CatalogPicker)
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
  return (
    <CatalogPicker
      items={items}
      onSelect={onSelect}
      searchPlaceholder={`Search ${label.toLowerCase()}...`}
      emptyMessage="No items found."
      trigger={
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
      }
      renderItem={(item) => (
        <div className="flex flex-col">
          <span>{item.name}</span>
          {item.type && (
            <span className="text-xs text-muted-foreground">{item.type}</span>
          )}
        </div>
      )}
    />
  );
}

// =============================================================================
// Generic Ingredient Tab
// =============================================================================

function IngredientTab({
  recipeId,
  editing,
  spec,
}: {
  recipeId: string;
  editing?: boolean;
  spec: IngredientTabSpec;
}) {
  const { fkColumn } = spec;
  const { isSaving } = useRecipeEditor();

  const { data: catalog = [], isLoading: catalogLoading } =
    useCatalog<CatalogItem>(
      spec.catalog.queryKey,
      spec.catalog.table,
      spec.catalog.select,
      CATALOG_ORDER
    );

  const { items, setItems, dirty, setDirty, prepareSave, isLoading } =
    useRecipeChildRows<Record<string, unknown>, IngredientRow>({
      recipeId,
      table: spec.table,
      select: spec.select,
      queryKey: spec.queryKey(recipeId),
      errorLabel: spec.errorLabel,
      mapRow: (r) => {
        const row: IngredientRow = {
          id: r.id as string | undefined,
          [fkColumn]: r[fkColumn],
          timing: r.timing as string | null,
          notes: r.notes as string | null,
          position: (r.position as number | null) ?? 0,
          catalogItem: r[spec.relation] as CatalogItem | undefined,
        };
        for (const field of spec.valueFields) row[field] = r[field];
        return row;
      },
      toInsert: (item) => {
        const payload: Record<string, unknown> = {
          [fkColumn]: item[fkColumn],
          timing: item.timing,
          notes: item.notes,
        };
        for (const field of spec.valueFields) payload[field] = item[field];
        return payload;
      },
    });

  useRegisterSaver(spec.saverKey, Boolean(editing && dirty), prepareSave);

  const addItem = useCallback(
    (cat: CatalogItem) => {
      if (items.some((i) => i[fkColumn] === cat.id)) return;
      setItems((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          [fkColumn]: cat.id,
          ...spec.newItemDefaults,
          position: prev.length,
          catalogItem: cat,
        } as IngredientRow,
      ]);
      setDirty(true);
    },
    [items, setItems, setDirty, spec, fkColumn]
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
    [setItems, setDirty]
  );

  const removeItem = useCallback(
    (index: number) => {
      setItems((prev) => prev.filter((_, i) => i !== index));
      setDirty(true);
    },
    [setItems, setDirty]
  );

  if (isLoading) return <Skeleton className="h-24 w-full" />;

  const availableCatalog = catalog.filter(
    (c) => !items.some((i) => i[fkColumn] === c.id)
  );

  return (
    <div className="space-y-4 pt-4">
      {editing && (
        <div className="flex justify-end">
          <CatalogSelector
            label={spec.label}
            items={availableCatalog}
            loading={catalogLoading}
            onSelect={addItem}
            disabled={isSaving}
          />
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          {spec.emptyMessage}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{spec.label}</TableHead>
              {spec.columns.map((col) => (
                <TableHead key={col.field} className={col.headClass}>
                  {col.header}
                </TableHead>
              ))}
              {editing && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => {
              const resolved =
                item.catalogItem ??
                catalog.find((c) => c.id === item[fkColumn]);
              return (
                <TableRow key={item[fkColumn] as string}>
                  {spec.showForm ? (
                    <TableCell>
                      <div>
                        <span className="font-medium">
                          {resolved?.name ?? "Unknown"}
                        </span>
                        {resolved?.form && (
                          <span className="text-xs text-muted-foreground ml-2">
                            ({resolved.form})
                          </span>
                        )}
                      </div>
                    </TableCell>
                  ) : (
                    <TableCell className="font-medium">
                      {resolved?.name ?? "Unknown"}
                    </TableCell>
                  )}
                  {spec.columns.map((col) => (
                    <IngredientCell
                      key={col.field}
                      col={col}
                      item={item}
                      index={index}
                      editing={editing}
                      updateItem={updateItem}
                    />
                  ))}
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

/** Renders one declarative column cell (view or edit mode). */
function IngredientCell({
  col,
  item,
  index,
  editing,
  updateItem,
}: {
  col: IngredientColumn;
  item: IngredientRow;
  index: number;
  editing?: boolean;
  updateItem: (index: number, field: string, value: unknown) => void;
}) {
  if (col.kind === "number") {
    const value = item[col.field] as number | null;
    return (
      <TableCell className="text-right">
        {editing ? (
          <Input
            type="number"
            step={col.step}
            min="0"
            value={col.nullable ? value ?? "" : value || ""}
            onChange={(e) =>
              updateItem(
                index,
                col.field,
                col.nullable
                  ? e.target.value
                    ? parseInt(e.target.value)
                    : null
                  : parseFloat(e.target.value) || 0
              )
            }
            className={col.inputClass}
          />
        ) : col.nullable ? (
          value ?? "—"
        ) : (
          value || "—"
        )}
      </TableCell>
    );
  }

  if (col.kind === "unit") {
    const unit = item.unit as string;
    return (
      <TableCell>
        {editing ? (
          <UnitSelect
            value={unit}
            onChange={(v) => updateItem(index, "unit", v)}
          />
        ) : (
          unit
        )}
      </TableCell>
    );
  }

  return (
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
