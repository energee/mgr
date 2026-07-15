"use client";

/**
 * Transfer Lines Editor
 *
 * Inline editor for location-transfer line items, rendered as the "Lines"
 * relation tab on the transfer detail page (src/entities/location-transfer.tsx).
 * Before it existed, transfers dead-ended after header creation: nothing in
 * the app could insert transfer_lines rows, so Ship was permanently disabled.
 *
 * - Lists existing transfer_lines with resolved item names (finished goods
 *   via finished_goods_with_availability, lots via inventory_lots), mirroring
 *   the name resolution in ship-transfer-dialog.tsx.
 * - Adds lines from a picker scoped to the transfer's from-bin: finished
 *   goods come from bin_inventory and inventory lots from bin_inventory_items,
 *   with on-hand quantity shown inline. Each option encodes exactly one of
 *   finished_good_id / inventory_lot_id, satisfying the
 *   transfer_lines_item_xor constraint (00073_data_enhancements.sql).
 * - Quantity edits on existing rows are buffered locally and committed on
 *   blur/Enter (one write per edit, not per keystroke).
 * - Add/edit/remove are gated to status "planned" — once shipping starts the
 *   ship_transfer_partial RPC consumes the lines, so the editor turns
 *   read-only and surfaces shipped quantities instead.
 *
 * Mutations invalidate transferKeys.lines(transferId) (covers the Ship dialog
 * and this editor's nested linesEdit key) plus the location_transfers entity
 * keys so lines_count refreshes on the header and list views.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ComboboxField, ComboboxItem } from "@/components/ui/combobox";
import { Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { entityKeys, transferKeys } from "@/lib/query-keys";
import { parseUnknownError } from "@/lib/errors";

// =============================================================================
// Types
// =============================================================================

type TransferLineRow = {
  id: string;
  finished_good_id: string | null;
  inventory_lot_id: string | null;
  quantity: number;
  quantity_shipped: number | null;
  /** Resolved display name for the line item */
  item_name: string;
};

/** An item physically present in the from-bin, offered by the picker. */
type SourceItem = {
  /** Option key encoding the XOR shape: `fg:<id>` or `lot:<id>` */
  key: string;
  finished_good_id: string | null;
  inventory_lot_id: string | null;
  name: string;
  /** On-hand quantity in the from-bin */
  available: number;
};

type TransferLinesEditorProps = {
  transferId: string;
  /** Source bin — the picker only offers stock present in this bin */
  fromBinId?: string | null;
  /** Transfer status; lines are editable only while "planned" */
  status?: string | null;
};

// =============================================================================
// Component
// =============================================================================

export function TransferLinesEditor({
  transferId,
  fromBinId,
  status,
}: TransferLinesEditorProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const editable = status === "planned";

  // New-line form state
  const [showAddRow, setShowAddRow] = useState(false);
  const [selectedKey, setSelectedKey] = useState("");
  const [newQuantity, setNewQuantity] = useState(1);

  // Buffered quantity edits for existing rows, keyed by line ID. Committed on
  // blur/Enter; invalid input reverts to the saved value.
  const [pendingEdits, setPendingEdits] = useState<Record<string, string>>({});

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  // Existing lines with resolved item names. Name resolution mirrors
  // ship-transfer-dialog.tsx (kept separate because lines can reference items
  // that no longer sit in the from-bin).
  const { data: lines, isLoading: linesLoading } = useQuery({
    queryKey: transferKeys.linesEdit(transferId),
    queryFn: async () => {
      const { data: rawLines, error } = await supabase
        .from("transfer_lines")
        .select(
          "id, finished_good_id, inventory_lot_id, quantity, quantity_shipped"
        )
        .eq("transfer_id", transferId)
        .order("created_at");
      if (error) throw error;
      if (!rawLines || rawLines.length === 0) return [] as TransferLineRow[];

      const fgIds = rawLines
        .filter((l) => l.finished_good_id)
        .map((l) => l.finished_good_id!);
      const lotIds = rawLines
        .filter((l) => l.inventory_lot_id)
        .map((l) => l.inventory_lot_id!);

      const nameMap = new Map<string, string>();

      const [fgResult, lotResult] = await Promise.all([
        fgIds.length > 0
          ? supabase
              .from("finished_goods_with_availability")
              .select("id, brand_name, selling_format_name, lot_number")
              .in("id", fgIds)
          : Promise.resolve({ data: null, error: null }),
        lotIds.length > 0
          ? supabase
              .from("inventory_lots")
              .select("id, lot_number, inventory_item:inventory_items(name)")
              .in("id", lotIds)
          : Promise.resolve({ data: null, error: null }),
      ]);

      for (const fg of fgResult.data ?? []) {
        if (!fg.id) continue;
        const parts = [
          fg.brand_name,
          fg.selling_format_name,
          fg.lot_number ? `(${fg.lot_number})` : null,
        ].filter(Boolean);
        nameMap.set(`fg:${fg.id}`, parts.join(" - "));
      }
      for (const lot of lotResult.data ?? []) {
        const item = lot.inventory_item as { name: string } | null;
        const itemName = item?.name ?? "Unknown Item";
        nameMap.set(
          `lot:${lot.id}`,
          lot.lot_number ? `${itemName} (${lot.lot_number})` : itemName
        );
      }

      return rawLines.map((line): TransferLineRow => {
        let itemName = "Unknown Item";
        if (line.finished_good_id) {
          itemName =
            nameMap.get(`fg:${line.finished_good_id}`) ?? "Finished Good";
        } else if (line.inventory_lot_id) {
          itemName =
            nameMap.get(`lot:${line.inventory_lot_id}`) ?? "Inventory Lot";
        }
        return { ...line, item_name: itemName };
      });
    },
  });

  // Items available in the from-bin (finished goods + inventory lots)
  const { data: sourceItems, isLoading: sourceLoading } = useQuery({
    queryKey: transferKeys.sourceItems(fromBinId ?? ""),
    enabled: !!fromBinId && editable,
    queryFn: async () => {
      const [fgResult, lotResult] = await Promise.all([
        supabase
          .from("bin_inventory")
          .select("finished_good_id, quantity")
          .eq("bin_id", fromBinId!)
          .gt("quantity", 0),
        supabase
          .from("bin_inventory_items")
          .select(
            "inventory_lot_id, quantity, inventory_lot:inventory_lots(lot_number, inventory_item:inventory_items(name))"
          )
          .eq("bin_id", fromBinId!)
          .gt("quantity", 0),
      ]);
      if (fgResult.error) throw fgResult.error;
      if (lotResult.error) throw lotResult.error;

      // Resolve finished-good display names
      const fgIds = (fgResult.data ?? []).map((r) => r.finished_good_id);
      const fgNames = new Map<string, string>();
      if (fgIds.length > 0) {
        const { data: fgs, error } = await supabase
          .from("finished_goods_with_availability")
          .select("id, brand_name, selling_format_name, lot_number")
          .in("id", fgIds);
        if (error) throw error;
        for (const fg of fgs ?? []) {
          if (!fg.id) continue;
          const parts = [
            fg.brand_name,
            fg.selling_format_name,
            fg.lot_number ? `(${fg.lot_number})` : null,
          ].filter(Boolean);
          fgNames.set(fg.id, parts.join(" - "));
        }
      }

      const items: SourceItem[] = [];
      for (const row of fgResult.data ?? []) {
        items.push({
          key: `fg:${row.finished_good_id}`,
          finished_good_id: row.finished_good_id,
          inventory_lot_id: null,
          name: fgNames.get(row.finished_good_id) ?? "Finished Good",
          available: row.quantity,
        });
      }
      for (const row of lotResult.data ?? []) {
        const lot = row.inventory_lot as {
          lot_number: string | null;
          inventory_item: { name: string } | null;
        } | null;
        const itemName = lot?.inventory_item?.name ?? "Unknown Item";
        items.push({
          key: `lot:${row.inventory_lot_id}`,
          finished_good_id: null,
          inventory_lot_id: row.inventory_lot_id,
          name: lot?.lot_number ? `${itemName} (${lot.lot_number})` : itemName,
          available: row.quantity,
        });
      }
      return items.sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const sourceItemMap = useMemo(() => {
    const map = new Map<string, SourceItem>();
    for (const item of sourceItems ?? []) map.set(item.key, item);
    return map;
  }, [sourceItems]);

  // Hide items that are already on a line — duplicates would double-move stock
  const pickerItems = useMemo(() => {
    const usedKeys = new Set(
      (lines ?? []).map((l) =>
        l.finished_good_id ? `fg:${l.finished_good_id}` : `lot:${l.inventory_lot_id}`
      )
    );
    return (sourceItems ?? []).filter((item) => !usedKeys.has(item.key));
  }, [sourceItems, lines]);

  const selectedItem = selectedKey ? sourceItemMap.get(selectedKey) : undefined;
  const exceedsAvailable =
    !!selectedItem && newQuantity > selectedItem.available;

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const invalidateAfterChange = () => {
    // Covers linesEdit (this editor) + lines (Ship dialog)
    queryClient.invalidateQueries({
      queryKey: transferKeys.lines(transferId),
    });
    queryClient.invalidateQueries({
      queryKey: transferKeys.detail(transferId),
    });
    // Refresh lines_count on the header/detail view and list pages
    queryClient.invalidateQueries({
      queryKey: entityKeys.all("location_transfers"),
    });
    queryClient.invalidateQueries({
      queryKey: entityKeys.all("location_transfers_with_details"),
    });
  };

  const addLine = useMutation({
    mutationFn: async (item: SourceItem) => {
      const { error } = await supabase.from("transfer_lines").insert({
        transfer_id: transferId,
        finished_good_id: item.finished_good_id,
        inventory_lot_id: item.inventory_lot_id,
        quantity: newQuantity,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAfterChange();
      setSelectedKey("");
      setNewQuantity(1);
      setShowAddRow(false);
      toast.success("Line added");
    },
    onError: (error) => {
      toast.error("Failed to add line", {
        description: parseUnknownError(error).message,
      });
    },
  });

  const updateLine = useMutation({
    mutationFn: async ({ id, quantity }: { id: string; quantity: number }) => {
      const { error } = await supabase
        .from("transfer_lines")
        .update({ quantity })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidateAfterChange(),
    onError: (error) => {
      toast.error("Failed to update line", {
        description: parseUnknownError(error).message,
      });
    },
  });

  const deleteLine = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("transfer_lines")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAfterChange();
      toast.success("Line removed");
    },
    onError: (error) => {
      toast.error("Failed to remove line", {
        description: parseUnknownError(error).message,
      });
    },
  });

  // Commit a buffered quantity edit on blur/Enter. Empty/NaN/non-positive
  // input is dropped so the field reverts to the saved value.
  const commitQuantityEdit = (line: TransferLineRow) => {
    const raw = pendingEdits[line.id];
    if (raw === undefined) return;
    setPendingEdits((prev) => {
      const next = { ...prev };
      delete next[line.id];
      return next;
    });
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return; // revert
    if (parsed === line.quantity) return; // no-op
    updateLine.mutate({ id: line.id, quantity: parsed });
  };

  const handleAdd = () => {
    if (!selectedItem) {
      toast.error("Select an item to transfer");
      return;
    }
    if (newQuantity < 1) {
      toast.error("Quantity must be at least 1");
      return;
    }
    addLine.mutate(selectedItem);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (linesLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const showShippedColumn = !editable;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Line Items</h3>
        {editable && !showAddRow && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowAddRow(true)}
            disabled={!fromBinId}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Line
          </Button>
        )}
      </div>

      {!editable && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Lock className="h-3.5 w-3.5" />
          Lines are locked once the transfer leaves Planned.
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead className="w-[140px] text-right">Quantity</TableHead>
            {showShippedColumn && (
              <TableHead className="w-[120px] text-right">Shipped</TableHead>
            )}
            {editable && <TableHead className="w-[60px]" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines?.map((line) => (
            <TableRow key={line.id}>
              <TableCell className="font-medium">{line.item_name}</TableCell>
              <TableCell className="text-right">
                {editable ? (
                  <Input
                    type="number"
                    min={1}
                    value={pendingEdits[line.id] ?? line.quantity}
                    onChange={(e) =>
                      setPendingEdits((prev) => ({
                        ...prev,
                        [line.id]: e.target.value,
                      }))
                    }
                    onBlur={() => commitQuantityEdit(line)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitQuantityEdit(line);
                    }}
                    className="h-8 w-[100px] ml-auto tabular-nums"
                  />
                ) : (
                  <span className="tabular-nums">{line.quantity}</span>
                )}
              </TableCell>
              {showShippedColumn && (
                <TableCell className="text-right tabular-nums">
                  {line.quantity_shipped ?? "—"}
                </TableCell>
              )}
              {editable && (
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove line"
                    className="h-8 w-8 text-destructive"
                    onClick={() => deleteLine.mutate(line.id)}
                    disabled={deleteLine.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}

          {/* Add new line row */}
          {editable && showAddRow && (
            <TableRow>
              <TableCell>
                <ComboboxField
                  value={selectedKey}
                  selectedLabel={selectedItem?.name ?? ""}
                  onValueChange={setSelectedKey}
                  onFilter={(values, search) => {
                    const term = search.toLowerCase();
                    return values.filter((v) =>
                      sourceItemMap.get(v)?.name.toLowerCase().includes(term)
                    );
                  }}
                  placeholder={
                    sourceLoading ? "Loading bin contents..." : "Select item"
                  }
                  emptyText="No transferable stock in the source bin"
                  anchorClassName="h-8"
                  inputClassName="h-8"
                >
                  {pickerItems.map((item) => (
                    <ComboboxItem
                      key={item.key}
                      value={item.key}
                      label={item.name}
                    >
                      <span className="flex items-center gap-2">
                        {item.name}
                        <Badge variant="secondary" className="text-xs">
                          {item.available} on hand
                        </Badge>
                      </span>
                    </ComboboxItem>
                  ))}
                </ComboboxField>
              </TableCell>
              <TableCell className="text-right">
                <Input
                  type="number"
                  min={1}
                  value={newQuantity}
                  onChange={(e) =>
                    setNewQuantity(parseInt(e.target.value, 10) || 1)
                  }
                  className="h-8 w-[100px] ml-auto tabular-nums"
                />
                {exceedsAvailable && (
                  <div className="text-xs text-orange-500 mt-1">
                    Exceeds on-hand ({selectedItem.available}). Ship partial
                    later or restock first.
                  </div>
                )}
              </TableCell>
              <TableCell>
                <Button
                  size="icon"
                  aria-label="Add line"
                  className="h-8 w-8"
                  onClick={handleAdd}
                  disabled={addLine.isPending || !selectedKey}
                >
                  {addLine.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                </Button>
              </TableCell>
            </TableRow>
          )}

          {/* Empty state */}
          {(!lines || lines.length === 0) && !showAddRow && (
            <TableRow>
              {/* 3 columns either way: Item + Quantity + (Shipped | actions) */}
              <TableCell
                colSpan={3}
                className="text-center text-muted-foreground py-8"
              >
                {editable
                  ? 'No line items yet. Click "Add Line" to choose items from the source bin.'
                  : "No line items on this transfer."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {showAddRow && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowAddRow(false);
              setSelectedKey("");
              setNewQuantity(1);
            }}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
