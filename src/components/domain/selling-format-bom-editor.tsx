"use client";

/**
 * SellingFormatBOMEditor — Bill of Materials editor for a selling format.
 *
 * Manages `selling_format_materials` rows: lets users add inventory items to
 * the BOM with a per-unit quantity and optional notes. Whole-unit materials
 * (each, case) render an "X per Y" pair of integer inputs; bulk materials
 * render a single decimal field. The stored value is always a decimal in
 * `quantity_per_unit` (DECIMAL(10,4)); the X-per-Y form is purely a UI
 * affordance, recovered on load via `ratioFromDecimal`.
 *
 * Each field saves on blur via direct Supabase mutations (not on form
 * submit). Deletions are immediate.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom } from "@/services/types";
import { entityKeys, materialPlanningKeys } from "@/lib/query-keys";
import { groupByCategory } from "./shipping-material-roles-editor";
import {
  useSellingFormatBOM,
  type SellingFormatMaterial,
} from "@/hooks/use-material-planning";
import { isWholeUnit, ratioFromDecimal } from "@/domain/inventory-units";
import { parsePositiveNumber } from "@/lib/format";
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
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

// =============================================================================
// Types
// =============================================================================

type InventoryItem = {
  id: string;
  name: string;
  category: string | null;
  unit: string | null;
};

type SellingFormatBOMEditorProps = {
  sellingFormatId: string;
  disabled?: boolean;
};

// =============================================================================
// Component
// =============================================================================

/**
 * Renders a bill-of-materials table for a selling format and provides
 * controls to add, edit (qty/notes on blur), and remove BOM line items.
 */
export function SellingFormatBOMEditor({
  sellingFormatId,
  disabled = false,
}: SellingFormatBOMEditorProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const { data: bomItems = [], isLoading: bomLoading } =
    useSellingFormatBOM(sellingFormatId);

  const { data: inventoryItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: entityKeys.list("inventory_items"),
    queryFn: async (): Promise<InventoryItem[]> => {
      const { data, error } = await dynamicFrom(supabase, "inventory_items")
        .select("id, name, category, unit")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as InventoryItem[];
    },
  });

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const invalidateBOM = () => {
    queryClient.invalidateQueries({
      queryKey: materialPlanningKeys.bom(sellingFormatId),
    });
  };

  const insertMutation = useMutation({
    mutationFn: async (item: InventoryItem) => {
      const { error } = await dynamicFrom(supabase, "selling_format_materials")
        .insert({
          selling_format_id: sellingFormatId,
          inventory_item_id: item.id,
          quantity_per_unit: 1,
          notes: null,
        } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateBOM();
      toast.success("Material added");
    },
    onError: () => {
      toast.error("Failed to add material");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: { quantity_per_unit?: number; notes?: string | null };
    }) => {
      const { error } = await dynamicFrom(supabase, "selling_format_materials")
        .update(updates as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateBOM();
    },
    onError: () => {
      toast.error("Failed to update material");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await dynamicFrom(supabase, "selling_format_materials")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateBOM();
      toast.success("Material removed");
    },
    onError: () => {
      toast.error("Failed to remove material");
    },
  });

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleAddItem(item: InventoryItem) {
    // Guard: already in BOM
    if (bomItems.some((b) => b.inventory_item_id === item.id)) {
      setAddOpen(false);
      return;
    }
    insertMutation.mutate(item);
    setAddOpen(false);
    setSearchValue("");
  }

  function handleQtyCommit(row: SellingFormatMaterial, qty: number) {
    if (Number.isFinite(qty) && qty > 0 && qty !== row.quantity_per_unit) {
      updateMutation.mutate({ id: row.id, updates: { quantity_per_unit: qty } });
    }
  }

  function handleNotesBlur(row: SellingFormatMaterial, value: string) {
    const notes = value.trim() === "" ? null : value.trim();
    if (notes !== row.notes) {
      updateMutation.mutate({ id: row.id, updates: { notes } });
    }
  }

  // ---------------------------------------------------------------------------
  // Available items (filtered out those already in BOM)
  // ---------------------------------------------------------------------------

  const addedIds = new Set(bomItems.map((b) => b.inventory_item_id));
  const availableItems = inventoryItems.filter((item) => !addedIds.has(item.id));

  // Group by category (uses shared utility)
  const grouped = useMemo(() => groupByCategory(availableItems), [availableItems]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isDisabled = disabled || bomLoading;

  return (
    <div className="space-y-4">
      {/* Add Material button */}
      <div className="flex items-center justify-end">
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={isDisabled || itemsLoading}
              className="gap-1"
            >
              <Plus className="h-4 w-4" />
              Add Material
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[380px] p-0" align="end">
            <Command>
              <CommandInput
                placeholder="Search inventory items..."
                value={searchValue}
                onValueChange={setSearchValue}
              />
              <CommandList>
                <CommandEmpty>No items found.</CommandEmpty>
                {Object.entries(grouped).map(([category, items]) => (
                  <CommandGroup key={category} heading={category}>
                    {items.map((item) => (
                      <CommandItem
                        key={item.id}
                        value={`${item.name} ${item.category ?? ""}`}
                        onSelect={() => handleAddItem(item)}
                        className="flex items-center justify-between"
                      >
                        <div className="flex flex-col">
                          <span>{item.name}</span>
                          {item.unit && (
                            <span className="text-xs text-muted-foreground">
                              {item.unit}
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

      {/* BOM table or empty state */}
      {bomItems.length === 0 ? (
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          <p>No materials defined yet.</p>
          <p className="text-sm mt-1">
            Click &quot;Add Material&quot; to build the bill of materials.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Material</TableHead>
              <TableHead className="w-32">Qty Per Unit</TableHead>
              <TableHead className="w-24">Unit</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bomItems.map((row) => (
              <BOMRow
                key={row.id}
                row={row}
                disabled={isDisabled}
                onQtyCommit={(qty) => handleQtyCommit(row, qty)}
                onNotesBlur={(val) => handleNotesBlur(row, val)}
                onDelete={() => deleteMutation.mutate(row.id)}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// =============================================================================
// BOMRow — individual editable row
// =============================================================================

type BOMRowProps = {
  row: SellingFormatMaterial;
  disabled: boolean;
  onQtyCommit: (qty: number) => void;
  onNotesBlur: (value: string) => void;
  onDelete: () => void;
};

/** A single editable row in the BOM table. Local state tracks field values. */
function BOMRow({ row, disabled, onQtyCommit, onNotesBlur, onDelete }: BOMRowProps) {
  const [notes, setNotes] = useState(row.notes ?? "");

  const item = row.inventory_item;
  const uom = item?.unit ?? "—";
  const whole = isWholeUnit(item?.unit);

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{item?.name ?? row.inventory_item_id}</div>
        {item?.category && (
          <div className="text-xs text-muted-foreground">{item.category}</div>
        )}
      </TableCell>
      <TableCell>
        <QtyEditor
          value={row.quantity_per_unit ?? 1}
          whole={whole}
          disabled={disabled}
          onCommit={onQtyCommit}
        />
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">{uom}</TableCell>
      <TableCell>
        <Input
          type="text"
          value={notes}
          placeholder="Optional notes…"
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => onNotesBlur(notes)}
          disabled={disabled}
          className="w-full"
        />
      </TableCell>
      <TableCell>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={disabled}
          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

// =============================================================================
// QtyEditor — decimal field for bulk; "X per Y" pair for whole-unit materials
// =============================================================================

type QtyEditorProps = {
  /** Current stored quantity_per_unit. */
  value: number;
  /** Whether the underlying inventory item is a whole/discrete unit. */
  whole: boolean;
  disabled?: boolean;
  /** Commits a new decimal value. Called on blur of either subfield. */
  onCommit: (qty: number) => void;
};

/**
 * Whole-unit materials (each, case): "N per M" pair of integer inputs.
 * Stored decimal is recovered into the nearest clean ratio on mount; if no
 * clean ratio fits, falls back to a single decimal input — same field used
 * by bulk materials.
 */
function QtyEditor({ value, whole, disabled, onCommit }: QtyEditorProps) {
  // Computed once on mount (only consumed by useState initializers below).
  const initialRatio = whole ? ratioFromDecimal(value) : null;
  const useRatio = whole && initialRatio !== null;

  const [num, setNum] = useState<string>(String(initialRatio?.numerator ?? 1));
  const [den, setDen] = useState<string>(String(initialRatio?.denominator ?? 1));
  const [decimal, setDecimal] = useState<string>(String(value));

  function commitRatio() {
    const n = parsePositiveNumber(num);
    const d = parsePositiveNumber(den);
    if (n !== null && d !== null) onCommit(n / d);
  }

  function commitDecimal() {
    const v = parsePositiveNumber(decimal);
    if (v !== null) onCommit(v);
  }

  if (useRatio) {
    return (
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          inputMode="numeric"
          min="1"
          step="1"
          value={num}
          onChange={(e) => setNum(e.target.value)}
          onBlur={commitRatio}
          disabled={disabled}
          className="w-14 text-right"
          aria-label="Quantity per pack"
        />
        <span className="text-xs text-muted-foreground">per</span>
        <Input
          type="number"
          inputMode="numeric"
          min="1"
          step="1"
          value={den}
          onChange={(e) => setDen(e.target.value)}
          onBlur={commitRatio}
          disabled={disabled}
          className="w-14 text-right"
          aria-label="Pack size"
        />
      </div>
    );
  }

  return (
    <Input
      type="number"
      step="0.001"
      min="0"
      value={decimal}
      onChange={(e) => setDecimal(e.target.value)}
      onBlur={commitDecimal}
      disabled={disabled}
      className="w-24 text-right"
      aria-label="Quantity per unit"
    />
  );
}
