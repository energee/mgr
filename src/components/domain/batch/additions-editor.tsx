"use client";

/**
 * AdditionsEditor - Recipe Additions Management Component
 *
 * General-purpose editor for managing recipe additions (clarifiers, nutrients, etc.).
 * Water salts and acids are typically managed via water addition profiles; use the
 * `excludeTypes` prop to filter them from the catalog on recipe pages.
 */

import { useMemo } from "react";
import { useCatalog } from "@/hooks/use-catalog";
import {
  TableCell,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  SortableRows,
  SortableHandleCell,
  RemoveRowCell,
  SortableDragPreview,
  useSortableRows,
} from "@/components/ui/sortable-rows";
import { CatalogAddPopover } from "@/components/ui/catalog-add-popover";
import { catalogKeys } from "@/lib/query-keys";

export type AdditionItem = {
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

type AdditiveCatalogItem = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  typical_amount: number | null;
  typical_unit: string | null;
}

type AdditionsEditorProps = {
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

/** Domain constants: additive type labels (not entity status -- no stateMachine applies). */
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
  const rows = useSortableRows({ items, onChange });

  const { data: rawCatalog = [], isLoading } = useCatalog<AdditiveCatalogItem>(catalogKeys.additives(), "additives", "id, name, type, description, typical_amount, typical_unit", ["type", "name"]);

  const additiveCatalog = useMemo(
    () =>
      excludeTypes.length > 0
        ? rawCatalog.filter((a) => !excludeTypes.includes(a.type))
        : rawCatalog,
    [rawCatalog, excludeTypes]
  );

  /** Adding an additive already in the list is a no-op (the popover still closes). */
  function handleAdd(additive: AdditiveCatalogItem) {
    if (items.some((item) => item.additive_id === additive.id)) return;

    let defaultTiming = "boil";
    if (additive.type === "water_salt" || additive.type === "acid") {
      defaultTiming = "mash";
    } else if (additive.type === "nutrient") {
      defaultTiming = "fermentation";
    }

    rows.append({
      additive_id: additive.id,
      amount: additive.typical_amount || 0,
      unit: additive.typical_unit || "g",
      timing: defaultTiming,
      target: WATER_CHEMISTRY_TYPES.includes(additive.type) ? "mash" : undefined,
      additive,
    });
  }

  const addedIds = useMemo(
    () => new Set(items.map((item) => item.additive_id)),
    [items]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Additions</h3>
        <CatalogAddPopover
          catalog={additiveCatalog}
          getId={(additive) => additive.id}
          excludeIds={addedIds}
          getGroup={(additive) => additive.type}
          groupLabels={TYPE_LABELS}
          getSearchValue={(additive) => additive.name}
          getLabel={(additive) => additive.name}
          getDetail={(additive) =>
            additive.description && (
              <span className="text-xs text-muted-foreground line-clamp-1">
                {additive.description}
              </span>
            )
          }
          onSelect={handleAdd}
          triggerLabel="Add Addition"
          searchPlaceholder="Search additives..."
          emptyMessage="No additives found."
          disabled={disabled || isLoading}
        />
      </div>

      <SortableRows
        items={items}
        onReorder={rows.reorder}
        getItemValue={(item) => item.additive_id}
        disabled={disabled}
        columns={[
          { className: "w-8" },
          { label: "Additive" },
          { label: "Amount", className: "w-24 text-right" },
          { label: "Unit", className: "w-20" },
          { label: "Timing", className: "w-28" },
          { label: "Target", className: "w-28" },
          { className: "w-16" },
        ]}
        empty={
          <div className="border rounded-md p-8 text-center text-muted-foreground">
            <p>No additions added yet.</p>
            <p className="text-sm mt-1">
              Click &quot;Add Addition&quot; to add water salts, clarifiers, nutrients, etc.
            </p>
          </div>
        }
        overlay={(item) => (
          <SortableDragPreview
            title={
              (item?.additive || additiveCatalog.find((a) => a.id === item?.additive_id))?.name ||
              "Addition"
            }
            subtitle={item ? `${item.amount} ${item.unit}` : undefined}
          />
        )}
        footer={
          <TableFooter>
            <TableRow>
              <TableCell colSpan={7} className="text-sm text-muted-foreground">
                {items.length} addition{items.length !== 1 ? "s" : ""}
              </TableCell>
            </TableRow>
          </TableFooter>
        }
      >
        {(item, index) => {
          const additive =
            item.additive || additiveCatalog.find((a) => a.id === item.additive_id);
          const showTarget = additive && WATER_CHEMISTRY_TYPES.includes(additive.type);

          return (
            <TableRow>
              <SortableHandleCell />
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
                    rows.updateField(index, "amount", parseFloat(e.target.value) || 0)
                  }
                  disabled={disabled}
                  className="w-20 text-right ml-auto"
                />
              </TableCell>
              <TableCell>
                <Select
                  value={item.unit}
                  onValueChange={(value) => rows.updateField(index, "unit", value)}
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
                  onValueChange={(value) => rows.updateField(index, "timing", value)}
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
                    onValueChange={(value) => rows.updateField(index, "target", value)}
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
              <RemoveRowCell onClick={() => rows.remove(index)} disabled={disabled} />
            </TableRow>
          );
        }}
      </SortableRows>
    </div>
  );
}
