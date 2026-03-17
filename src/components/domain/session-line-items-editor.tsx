"use client";

/**
 * Session Line Items Editor
 *
 * Inline editor for packaging session line items. Each line item represents
 * a product (brand + format) being packaged from a single source batch
 * with planned/actual quantities.
 *
 * Uses unified selling_format_id (containers + selling_formats model).
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useSessionLineItems,
  useLineItemMutations,
  validateNewItem,
  EMPTY_NEW_ITEM,
  type NewItemState,
} from "@/hooks/use-session-line-items";
import { parseIntOrNull } from "@/lib/format";
import { BatchCell, FormatCell, AddLineItemRow } from "./packaging-shared";

// =============================================================================
// Types
// =============================================================================

type SessionLineItemsEditorProps = {
  sessionId: string;
  readOnly?: boolean;
};

// =============================================================================
// Component
// =============================================================================

export function SessionLineItemsEditor({
  sessionId,
  readOnly = false,
}: SessionLineItemsEditorProps) {
  const [newItem, setNewItem] = useState<NewItemState>({ ...EMPTY_NEW_ITEM });
  const [showAddRow, setShowAddRow] = useState(false);

  // Data
  const { items, isLoading: itemsLoading, totalPlanned, totalActual } =
    useSessionLineItems(sessionId);
  const { addItem, updateItem, deleteItem, handleFormatChange, kegFormatIds } =
    useLineItemMutations(sessionId);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleAdd = () => {
    const error = validateNewItem(newItem);
    if (error) {
      toast.error(error);
      return;
    }
    addItem.mutate(newItem, {
      onSuccess: () => {
        setNewItem({ ...EMPTY_NEW_ITEM });
        setShowAddRow(false);
      },
    });
  };

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (itemsLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Line Items</h3>
        {!readOnly && !showAddRow && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowAddRow(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Line Item
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Brand</TableHead>
            <TableHead>Batch</TableHead>
            <TableHead>Format</TableHead>
            <TableHead className="w-[120px]">Planned Qty</TableHead>
            <TableHead className="w-[120px]">Actual Qty</TableHead>
            {!readOnly && <TableHead className="w-[60px]" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items?.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item.brand_name}</TableCell>

              <TableCell>
                <BatchCell
                  brandId={item.brand_id}
                  currentBatchId={item.batch_id ?? ""}
                  onSelect={(batchId) =>
                    updateItem.mutate({
                      id: item.id,
                      field: "batch_id",
                      value: batchId,
                    })
                  }
                  readOnly={readOnly}
                />
              </TableCell>

              <TableCell>
                {readOnly ? (
                  <span className="flex items-center gap-1.5">
                    {item.selling_format_name ?? "—"}
                    {item.selling_format_id &&
                      kegFormatIds.has(item.selling_format_id) &&
                      item.keg_owner_name && (
                        <Badge variant="outline" className="text-xs">
                          {item.keg_owner_name}
                        </Badge>
                      )}
                  </span>
                ) : (
                  <FormatCell
                    formatId={item.selling_format_id ?? ""}
                    onFormatChange={(v) => handleFormatChange(item.id, v)}
                    kegOwnerId={item.keg_owner_id || ""}
                    onKegOwnerChange={(v) =>
                      updateItem.mutate({
                        id: item.id,
                        field: "keg_owner_id",
                        value: v || null,
                      })
                    }
                  />
                )}
              </TableCell>

              <TableCell>
                {readOnly ? (
                  item.planned_quantity ?? "—"
                ) : (
                  <Input
                    type="number"
                    min={0}
                    key={`planned-${item.id}-${item.planned_quantity}`}
                    defaultValue={item.planned_quantity ?? ""}
                    onBlur={(e) =>
                      updateItem.mutate({
                        id: item.id,
                        field: "planned_quantity",
                        value: parseIntOrNull(e.target.value),
                      })
                    }
                    className="h-8 w-full"
                    placeholder="—"
                  />
                )}
              </TableCell>

              <TableCell>
                {readOnly ? (
                  item.actual_quantity ?? "—"
                ) : (
                  <Input
                    type="number"
                    min={0}
                    key={`actual-${item.id}-${item.actual_quantity}`}
                    defaultValue={item.actual_quantity ?? ""}
                    onBlur={(e) =>
                      updateItem.mutate({
                        id: item.id,
                        field: "actual_quantity",
                        value: parseIntOrNull(e.target.value),
                      })
                    }
                    className="h-8 w-full"
                    placeholder="—"
                  />
                )}
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
            <AddLineItemRow
              newItem={newItem}
              onChange={setNewItem}
              onAdd={handleAdd}
              isPending={addItem.isPending}
            />
          )}

          {/* Empty state */}
          {(!items || items.length === 0) && !showAddRow && (
            <TableRow>
              <TableCell
                colSpan={6}
                className="text-center text-muted-foreground py-8"
              >
                No line items yet. Click &quot;Add Line Item&quot; to add
                products to this packaging session.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {items && items.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="text-right font-medium">
                Totals
              </TableCell>
              <TableCell className="font-bold">{totalPlanned}</TableCell>
              <TableCell className="font-bold">{totalActual}</TableCell>
              {!readOnly && <TableCell />}
            </TableRow>
          </TableFooter>
        )}
      </Table>

      {showAddRow && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAddRow(false)}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
