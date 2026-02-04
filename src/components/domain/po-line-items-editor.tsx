"use client";

/**
 * PO Line Items Editor
 *
 * Inline editor for purchase order line items. Supports catalog type selection
 * and dynamic item lookup based on type (malt, hop, yeast, etc.).
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Combobox,
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { purchaseOrderKeys, catalogKeys } from "@/lib/query-keys";
import {
  CATALOG_TYPES,
  CATALOG_TABLES,
  getCatalogTypeLabel,
  isFreeTextCatalogType,
} from "@/entities/po-line-item";

// =============================================================================
// Types
// =============================================================================

interface POLineItemRow {
  id: string;
  catalog_type: string;
  catalog_id: string;
  catalog_name: string;
  quantity: number;
  unit: string;
  unit_price: number | null;
}

interface POLineItemsEditorProps {
  poId: string;
  readOnly?: boolean;
}

interface NewItemState {
  catalog_type: string;
  catalog_id: string;
  quantity: number;
  unit: string;
  unit_price: number;
}

interface CatalogItem {
  id: string;
  name: string;
}

// =============================================================================
// Component
// =============================================================================

export function POLineItemsEditor({ poId, readOnly = false }: POLineItemsEditorProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  // New item form state
  const [newItem, setNewItem] = useState<NewItemState>({
    catalog_type: "",
    catalog_id: "",
    quantity: 1,
    unit: "lb",
    unit_price: 0,
  });
  const [showAddRow, setShowAddRow] = useState(false);

  // Fetch PO line items with resolved catalog names
  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: purchaseOrderKeys.lineItems(poId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("po_line_items")
        .select("*")
        .eq("po_id", poId)
        .order("created_at", { ascending: true });
      if (error) throw error;

      // Resolve catalog item names
      // Group items by catalog_type to batch queries
      const itemsByType = new Map<string, typeof data>();
      data.forEach((item) => {
        const existing = itemsByType.get(item.catalog_type) || [];
        itemsByType.set(item.catalog_type, [...existing, item]);
      });

      // Fetch names from each catalog table
      const nameMap = new Map<string, string>();
      for (const [catalogType, typeItems] of itemsByType) {
        // For "other" type, use catalog_id directly as name (it's free text)
        if (isFreeTextCatalogType(catalogType)) {
          typeItems.forEach((item) => {
            nameMap.set(`${catalogType}:${item.catalog_id}`, item.catalog_id);
          });
          continue;
        }

        const table = CATALOG_TABLES[catalogType];
        if (!table) continue;

        const catalogIds = typeItems.map((i) => i.catalog_id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: catalogData } = await (supabase as any)
          .from(table)
          .select("id, name")
          .in("id", catalogIds);

        catalogData?.forEach((ci: { id: string; name: string }) => {
          nameMap.set(`${catalogType}:${ci.id}`, ci.name);
        });
      }

      // Return items with resolved names
      return data.map((item) => ({
        ...item,
        catalog_name: nameMap.get(`${item.catalog_type}:${item.catalog_id}`) || item.catalog_id,
      })) as POLineItemRow[];
    },
  });

  // Fetch catalog items based on selected type (not for free-text types)
  const { data: catalogItems } = useQuery({
    queryKey: catalogKeys.items(newItem.catalog_type),
    queryFn: async () => {
      if (!newItem.catalog_type || !CATALOG_TABLES[newItem.catalog_type]) {
        return [];
      }
      const table = CATALOG_TABLES[newItem.catalog_type];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from(table)
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data as CatalogItem[];
    },
    enabled: !!newItem.catalog_type && !isFreeTextCatalogType(newItem.catalog_type) && !!CATALOG_TABLES[newItem.catalog_type],
  });

  // Add item mutation
  const addItem = useMutation({
    mutationFn: async (item: NewItemState) => {
      const { error } = await supabase.from("po_line_items").insert({
        po_id: poId,
        catalog_type: item.catalog_type,
        catalog_id: item.catalog_id,
        quantity: item.quantity,
        unit: item.unit,
        unit_price: item.unit_price || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.lineItems(poId) });
      setNewItem({ catalog_type: "", catalog_id: "", quantity: 1, unit: "lb", unit_price: 0 });
      setShowAddRow(false);
      toast.success("Item added");
    },
    onError: () => {
      toast.error("Failed to add item");
    },
  });

  // Update item mutation
  const updateItem = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: unknown }) => {
      const { error } = await supabase
        .from("po_line_items")
        .update({ [field]: value })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.lineItems(poId) });
    },
    onError: () => {
      toast.error("Failed to update item");
    },
  });

  // Delete item mutation
  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("po_line_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.lineItems(poId) });
      toast.success("Item removed");
    },
    onError: () => {
      toast.error("Failed to remove item");
    },
  });

  // Calculate totals
  const total = items?.reduce((sum, item) => {
    return sum + (item.quantity * (item.unit_price || 0));
  }, 0) || 0;

  // Handle add item
  const handleAdd = () => {
    if (!newItem.catalog_type) {
      toast.error("Please select item type");
      return;
    }
    if (!newItem.catalog_id) {
      toast.error(isFreeTextCatalogType(newItem.catalog_type) ? "Please enter item description" : "Please select an item");
      return;
    }
    if (newItem.quantity <= 0) {
      toast.error("Quantity must be greater than zero");
      return;
    }
    if (!newItem.unit) {
      toast.error("Unit is required");
      return;
    }
    addItem.mutate(newItem);
  };

  if (itemsLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Line Items</h3>
        {!readOnly && !showAddRow && (
          <Button size="sm" variant="outline" onClick={() => setShowAddRow(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Item
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[100px]">Type</TableHead>
            <TableHead>Item</TableHead>
            <TableHead className="w-[100px]">Qty</TableHead>
            <TableHead className="w-[80px]">Unit</TableHead>
            <TableHead className="w-[120px]">Unit Price</TableHead>
            <TableHead className="w-[100px] text-right">Line Total</TableHead>
            {!readOnly && <TableHead className="w-[60px]" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items?.map((item) => (
            <TableRow key={item.id}>
              <TableCell>{getCatalogTypeLabel(item.catalog_type)}</TableCell>
              <TableCell className="font-medium">
                {item.catalog_name}
              </TableCell>
              <TableCell>
                {readOnly ? (
                  item.quantity
                ) : (
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    value={item.quantity}
                    onChange={(e) =>
                      updateItem.mutate({
                        id: item.id,
                        field: "quantity",
                        value: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="h-8 w-full"
                  />
                )}
              </TableCell>
              <TableCell>
                {readOnly ? (
                  item.unit
                ) : (
                  <Input
                    type="text"
                    value={item.unit}
                    onChange={(e) =>
                      updateItem.mutate({
                        id: item.id,
                        field: "unit",
                        value: e.target.value,
                      })
                    }
                    className="h-8 w-full"
                  />
                )}
              </TableCell>
              <TableCell>
                {readOnly ? (
                  item.unit_price ? `$${item.unit_price.toFixed(2)}` : "—"
                ) : (
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    value={item.unit_price || ""}
                    onChange={(e) =>
                      updateItem.mutate({
                        id: item.id,
                        field: "unit_price",
                        value: parseFloat(e.target.value) || null,
                      })
                    }
                    className="h-8 w-full"
                    placeholder="0.00"
                  />
                )}
              </TableCell>
              <TableCell className="text-right font-medium">
                ${((item.quantity || 0) * (item.unit_price || 0)).toFixed(2)}
              </TableCell>
              {!readOnly && (
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => deleteItem.mutate(item.id)}
                    disabled={deleteItem.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}

          {/* Add new item row */}
          {showAddRow && (
            <TableRow>
              <TableCell>
                <Select
                  value={newItem.catalog_type}
                  onValueChange={(value) =>
                    setNewItem({ ...newItem, catalog_type: value, catalog_id: "" })
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATALOG_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                {isFreeTextCatalogType(newItem.catalog_type) ? (
                  <Input
                    type="text"
                    value={newItem.catalog_id}
                    onChange={(e) => setNewItem({ ...newItem, catalog_id: e.target.value })}
                    disabled={!newItem.catalog_type}
                    className="h-8 w-full"
                    placeholder="Enter item description"
                  />
                ) : (
                  <Combobox
                    value={newItem.catalog_id}
                    onValueChange={(v) => setNewItem({ ...newItem, catalog_id: v })}
                    disabled={!newItem.catalog_type}
                    onFilter={(values, search) => {
                      const term = search.toLowerCase();
                      return values.filter((v) => catalogItems?.find((ci) => ci.id === v)?.name.toLowerCase().includes(term));
                    }}
                  >
                    <ComboboxAnchor className="h-8">
                      <ComboboxInput className="h-8" placeholder={newItem.catalog_type ? "Search items..." : "Select type first"} />
                      <ComboboxTrigger />
                    </ComboboxAnchor>
                    <ComboboxContent>
                      <ComboboxEmpty>No items found</ComboboxEmpty>
                      {catalogItems?.map((item) => (
                        <ComboboxItem key={item.id} value={item.id} label={item.name}>
                          {item.name}
                        </ComboboxItem>
                      ))}
                    </ComboboxContent>
                  </Combobox>
                )}
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={newItem.quantity}
                  onChange={(e) =>
                    setNewItem({ ...newItem, quantity: parseFloat(e.target.value) || 0 })
                  }
                  className="h-8 w-full"
                />
              </TableCell>
              <TableCell>
                <Input
                  type="text"
                  value={newItem.unit}
                  onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
                  className="h-8 w-full"
                  placeholder="lb"
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={newItem.unit_price || ""}
                  onChange={(e) =>
                    setNewItem({ ...newItem, unit_price: parseFloat(e.target.value) || 0 })
                  }
                  className="h-8 w-full"
                  placeholder="0.00"
                />
              </TableCell>
              <TableCell className="text-right font-medium">
                ${(newItem.quantity * newItem.unit_price).toFixed(2)}
              </TableCell>
              <TableCell>
                <Button
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleAdd}
                  disabled={addItem.isPending}
                >
                  {addItem.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                </Button>
              </TableCell>
            </TableRow>
          )}

          {/* Empty state */}
          {(!items || items.length === 0) && !showAddRow && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                No line items yet. Click &quot;Add Item&quot; to add items to this purchase order.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {items && items.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={5} className="text-right font-medium">
                Subtotal
              </TableCell>
              <TableCell className="text-right font-bold text-lg">
                ${total.toFixed(2)}
              </TableCell>
              {!readOnly && <TableCell />}
            </TableRow>
          </TableFooter>
        )}
      </Table>

      {showAddRow && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setShowAddRow(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
