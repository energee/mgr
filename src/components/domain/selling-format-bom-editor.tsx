"use client";

/**
 * SellingFormatBOMEditor — Bill of Materials editor for a selling format.
 *
 * Manages `selling_format_materials` rows: lets users add inventory items to the
 * BOM with a per-unit quantity and optional notes. Each field saves on blur via
 * direct Supabase mutations (not on form submit). Deletions are immediate.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom } from "@/services/types";
import { entityKeys, materialPlanningKeys } from "@/lib/query-keys";
import {
  useSellingFormatBOM,
  type SellingFormatMaterial,
} from "@/hooks/use-material-planning";
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
  unit_of_measure: string | null;
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
        .select("id, name, category, unit_of_measure")
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
          unit_of_measure: item.unit_of_measure ?? null,
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

  function handleQtyBlur(row: SellingFormatMaterial, rawValue: string) {
    const qty = parseFloat(rawValue);
    if (!isNaN(qty) && qty !== row.quantity_per_unit) {
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

  // Group by category
  const grouped: Record<string, InventoryItem[]> = {};
  for (const item of availableItems) {
    const cat = item.category ?? "Other";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  }

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
                          {item.unit_of_measure && (
                            <span className="text-xs text-muted-foreground">
                              {item.unit_of_measure}
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
                onQtyBlur={(val) => handleQtyBlur(row, val)}
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
  onQtyBlur: (value: string) => void;
  onNotesBlur: (value: string) => void;
  onDelete: () => void;
};

/** A single editable row in the BOM table. Local state tracks field values. */
function BOMRow({ row, disabled, onQtyBlur, onNotesBlur, onDelete }: BOMRowProps) {
  const [qty, setQty] = useState(String(row.quantity_per_unit ?? "1"));
  const [notes, setNotes] = useState(row.notes ?? "");

  const item = row.inventory_item;
  const uom = item?.unit_of_measure ?? row.unit_of_measure ?? "—";

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{item?.name ?? row.inventory_item_id}</div>
        {item?.category && (
          <div className="text-xs text-muted-foreground">{item.category}</div>
        )}
      </TableCell>
      <TableCell>
        <Input
          type="number"
          step="0.001"
          min="0"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onBlur={() => onQtyBlur(qty)}
          disabled={disabled}
          className="w-24 text-right"
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
