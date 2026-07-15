"use client";

/**
 * PO Line Items Editor
 *
 * Inline editor for purchase order line items. Supports catalog type selection
 * and dynamic item lookup based on type (malt, hop, yeast, etc.).
 *
 * Qty/price edits on existing rows are buffered locally and committed on
 * blur/Enter through the shared line-item parser (order-item-edit-utils.ts,
 * `parsePoItemFieldEdit`) — one validated write per edit instead of an
 * unvalidated write per keystroke. Invalid input (empty/NaN/negative price/
 * non-positive qty) reverts to the saved value. The add row holds raw input
 * strings and parses them on Add, so an explicit $0 price is stored as 0 and
 * only a blank price means unpriced (NULL) — the old `parseFloat(...) || null`
 * path stored $0 as NULL (audit UI-6, the PO twin of order M10).
 *
 * Units come from the shared INVENTORY_UNIT_OPTIONS list (same list as
 * inventory items/lots) so units survive the accept-into-inventory copy;
 * legacy free-text units on existing rows are still rendered as an extra
 * option so they display and round-trip until deliberately changed.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom } from "@/services/types";
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
  ComboboxField,
  ComboboxItem,
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
import { INVENTORY_UNIT_OPTIONS } from "@/domain/inventory-units";
import {
  parsePoItemFieldEdit,
  type EditableItemField,
} from "@/domain/sales/order-item-edit-utils";

// =============================================================================
// Types
// =============================================================================

type POLineItemRow = {
  id: string;
  catalog_type: string;
  catalog_id: string;
  catalog_name: string;
  quantity: number;
  unit: string;
  unit_price: number | null;
}

type POLineItemsEditorProps = {
  poId: string;
  readOnly?: boolean;
}

/**
 * Add-row form state. Quantity/price hold RAW input strings; they are parsed
 * via the shared parser only when the user commits the row (handleAdd), so
 * mid-typing values are never coerced and "$0" survives as an explicit price.
 */
type NewItemState = {
  catalog_type: string;
  catalog_id: string;
  quantity: string;
  unit: string;
  unit_price: string;
}

/** Parsed insert payload produced by handleAdd (null price = unpriced). */
type NewItemInsert = {
  catalog_type: string;
  catalog_id: string;
  quantity: number;
  unit: string;
  unit_price: number | null;
}

type CatalogItem = {
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
    quantity: "1",
    unit: "lb",
    unit_price: "",
  });
  const [showAddRow, setShowAddRow] = useState(false);

  // Local buffer for existing-row qty/price edits, keyed by `${itemId}:${field}`.
  // Raw strings are held while typing and committed on blur/Enter via
  // commitItemEdit — mirrors the pendingEdits pattern in order-items-editor.tsx.
  const [pendingEdits, setPendingEdits] = useState<Record<string, string>>({});

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
        const { data: catalogData } = await dynamicFrom(supabase, table)
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
      const { data, error } = await dynamicFrom(supabase, table)
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data as CatalogItem[];
    },
    enabled: !!newItem.catalog_type && !isFreeTextCatalogType(newItem.catalog_type) && !!CATALOG_TABLES[newItem.catalog_type],
  });

  // Add item mutation. Takes the parsed payload from handleAdd — unit_price is
  // already number | null there (0 is a real price; null means unpriced).
  const addItem = useMutation({
    mutationFn: async (item: NewItemInsert) => {
      const { error } = await supabase.from("po_line_items").insert({
        po_id: poId,
        catalog_type: item.catalog_type,
        catalog_id: item.catalog_id,
        quantity: item.quantity,
        unit: item.unit,
        unit_price: item.unit_price,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.lineItems(poId) });
      setNewItem({ catalog_type: "", catalog_id: "", quantity: "1", unit: "lb", unit_price: "" });
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

  // Buffer a keystroke for an existing row's qty/price input
  const setPendingEdit = (itemId: string, field: EditableItemField, raw: string) => {
    setPendingEdits((prev) => ({ ...prev, [`${itemId}:${field}`]: raw }));
  };

  // Commit a buffered qty/price edit on blur/Enter. Invalid input
  // (empty/NaN/negative price/non-positive qty) is dropped so the field
  // reverts to the saved value; unchanged values skip the write entirely.
  const commitItemEdit = (item: POLineItemRow, field: EditableItemField) => {
    const key = `${item.id}:${field}`;
    const raw = pendingEdits[key];
    if (raw === undefined) return; // nothing typed since last commit
    setPendingEdits((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    const parsed = parsePoItemFieldEdit(field, raw);
    if (parsed === null) return; // revert to saved value
    const current = field === "quantity" ? item.quantity : item.unit_price;
    if (parsed === current) return; // no-op — avoid the write
    updateItem.mutate({ id: item.id, field, value: parsed });
  };

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

  // Parsed add-row values for the live line-total preview
  const newQuantity = parsePoItemFieldEdit("quantity", newItem.quantity);
  const newUnitPrice = parsePoItemFieldEdit("unit_price", newItem.unit_price);

  // Handle add item — parse the raw add-row strings through the shared parser.
  // A blank price means unpriced (NULL); anything typed must parse to a
  // non-negative number, and $0 is stored as 0, not NULL.
  const handleAdd = () => {
    if (!newItem.catalog_type) {
      toast.error("Please select item type");
      return;
    }
    if (!newItem.catalog_id) {
      toast.error(isFreeTextCatalogType(newItem.catalog_type) ? "Please enter item description" : "Please select an item");
      return;
    }
    if (newQuantity === null) {
      toast.error("Quantity must be greater than zero");
      return;
    }
    if (!newItem.unit) {
      toast.error("Unit is required");
      return;
    }
    if (newItem.unit_price.trim() !== "" && newUnitPrice === null) {
      toast.error("Price must be zero or greater");
      return;
    }
    addItem.mutate({
      catalog_type: newItem.catalog_type,
      catalog_id: newItem.catalog_id,
      quantity: newQuantity,
      unit: newItem.unit,
      unit_price: newUnitPrice,
    });
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
                    value={pendingEdits[`${item.id}:quantity`] ?? item.quantity}
                    onChange={(e) => setPendingEdit(item.id, "quantity", e.target.value)}
                    onBlur={() => commitItemEdit(item, "quantity")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitItemEdit(item, "quantity");
                    }}
                    className="h-8 w-full"
                  />
                )}
              </TableCell>
              <TableCell>
                {readOnly ? (
                  item.unit
                ) : (
                  <UnitSelect
                    value={item.unit}
                    onChange={(value) =>
                      updateItem.mutate({
                        id: item.id,
                        field: "unit",
                        value,
                      })
                    }
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
                    value={pendingEdits[`${item.id}:unit_price`] ?? item.unit_price ?? ""}
                    onChange={(e) => setPendingEdit(item.id, "unit_price", e.target.value)}
                    onBlur={() => commitItemEdit(item, "unit_price")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitItemEdit(item, "unit_price");
                    }}
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
                    aria-label="Remove line item"
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
                  <ComboboxField
                    value={newItem.catalog_id}
                    selectedLabel={
                      catalogItems?.find((ci) => ci.id === newItem.catalog_id)?.name ?? ""
                    }
                    onValueChange={(v) => setNewItem({ ...newItem, catalog_id: v })}
                    disabled={!newItem.catalog_type}
                    onFilter={(values, search) => {
                      const term = search.toLowerCase();
                      return values.filter((v) => catalogItems?.find((ci) => ci.id === v)?.name.toLowerCase().includes(term));
                    }}
                    placeholder={newItem.catalog_type ? "Search items..." : "Select type first"}
                    emptyText="No items found"
                    anchorClassName="h-8"
                    inputClassName="h-8"
                  >
                    {catalogItems?.map((item) => (
                      <ComboboxItem key={item.id} value={item.id} label={item.name}>
                        {item.name}
                      </ComboboxItem>
                    ))}
                  </ComboboxField>
                )}
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={newItem.quantity}
                  onChange={(e) =>
                    setNewItem({ ...newItem, quantity: e.target.value })
                  }
                  className="h-8 w-full"
                />
              </TableCell>
              <TableCell>
                <UnitSelect
                  value={newItem.unit}
                  onChange={(value) => setNewItem({ ...newItem, unit: value })}
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={newItem.unit_price}
                  onChange={(e) =>
                    setNewItem({ ...newItem, unit_price: e.target.value })
                  }
                  className="h-8 w-full"
                  placeholder="0.00"
                />
              </TableCell>
              <TableCell className="text-right font-medium">
                ${((newQuantity ?? 0) * (newUnitPrice ?? 0)).toFixed(2)}
              </TableCell>
              <TableCell>
                <Button
                  size="icon"
                  aria-label="Add line item"
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

// =============================================================================
// UnitSelect — shared-list unit picker for table cells
// =============================================================================

/**
 * Compact unit Select backed by the shared INVENTORY_UNIT_OPTIONS list.
 * Rows created before units were constrained may hold free-text values
 * ("sack", "55lb bag") — those are rendered as an extra option so the
 * stored value stays visible and is preserved unless deliberately changed.
 */
function UnitSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const isLegacyValue =
    !!value && !INVENTORY_UNIT_OPTIONS.some((u) => u.value === value);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-full" aria-label="Unit">
        <SelectValue placeholder="Unit" />
      </SelectTrigger>
      <SelectContent>
        {isLegacyValue && <SelectItem value={value}>{value}</SelectItem>}
        {INVENTORY_UNIT_OPTIONS.map((u) => (
          <SelectItem key={u.value} value={u.value}>
            {u.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
