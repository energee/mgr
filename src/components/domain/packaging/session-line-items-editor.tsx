"use client";

/**
 * Session Line Items Editor
 *
 * Inline editor for packaging session line items. Each line item represents
 * a product (brand + format) being packaged from a single source batch
 * with planned/actual quantities. The quick-add row is batch-first (brand
 * derives from the batch) and stays open with batch/brand carried over
 * between adds.
 *
 * Layout adapts to hands-on use (audit F-38): below the md breakpoint
 * (useIsMobile) line items render as stacked cards with full-width
 * controls instead of the table; on coarse-pointer devices that keep the
 * table (useIsTouch, e.g. tablets) the quantity inputs and delete button
 * get enlarged hit areas. The quick-add row reuses AddLineItemRow on
 * mobile too, with its cells stacked vertically via CSS so adding never
 * needs horizontal panning.
 *
 * Uses unified selling_format_id (containers + selling_formats model).
 *
 * Add-row visibility and the heading/Cancel shell come from the shared
 * line-items editor primitives
 * (src/components/domain/shared/line-items-editor.tsx).
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import { toast } from "sonner";
import {
  useSessionLineItems,
  useLineItemMutations,
  validateNewItem,
  EMPTY_NEW_ITEM,
  type LineItemRow,
  type NewItemState,
} from "@/hooks/use-session-line-items";
import { parseIntOrNull } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useIsMobile, useIsTouch } from "@/hooks/use-mobile";
import { BatchCell, FormatCell } from "./packaging-shared";
import { AddLineItemRow } from "./add-line-item-row";
import {
  DeleteLineButton,
  LineItemsEditorShell,
  LineItemsEmptyRow,
  LineItemsLoading,
  useAddRow,
} from "@/components/domain/shared/line-items-editor";

// =============================================================================
// Types
// =============================================================================

type SessionLineItemsEditorProps = {
  sessionId: string;
  readOnly?: boolean;
};

// Component
// =============================================================================

export function SessionLineItemsEditor({
  sessionId,
  readOnly = false,
}: SessionLineItemsEditorProps) {
  const [newItem, setNewItem] = useState<NewItemState>({ ...EMPTY_NEW_ITEM });
  const addRow = useAddRow();
  const isMobile = useIsMobile();
  const isTouch = useIsTouch();

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
      // Keep the add row open and carry over batch + brand so multi-format
      // runs from one batch need only format + quantities per line; the
      // Cancel button below the table closes the row when done.
      onSuccess: () =>
        setNewItem({
          ...EMPTY_NEW_ITEM,
          brand_id: newItem.brand_id,
          batch_id: newItem.batch_id,
        }),
    });
  };

  // ---------------------------------------------------------------------------
  // Shared per-item controls (used by both the table and mobile-card layouts)
  // ---------------------------------------------------------------------------

  const renderBatch = (item: LineItemRow) => (
    <BatchCell
      brandId={item.brand_id}
      currentBatchId={item.batch_id ?? ""}
      currentBatchCode={item.batch_code}
      onSelect={(batchId) =>
        updateItem.mutate({ id: item.id, field: "batch_id", value: batchId })
      }
      readOnly={readOnly}
    />
  );

  const renderFormat = (item: LineItemRow) =>
    readOnly ? (
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
    );

  const renderQty = (
    item: LineItemRow,
    field: "planned_quantity" | "actual_quantity",
    heightClass: string
  ) =>
    readOnly ? (
      item[field] ?? "—"
    ) : (
      <Input
        type="number"
        min={0}
        key={`${field}-${item.id}-${item[field]}`}
        defaultValue={item[field] ?? ""}
        onBlur={(e) =>
          updateItem.mutate({
            id: item.id,
            field,
            value: parseIntOrNull(e.target.value),
          })
        }
        className={cn("w-full", heightClass)}
        placeholder="—"
      />
    );

  const renderDelete = (item: LineItemRow, sizeClass: string) => (
    <DeleteLineButton
      label="Remove line item"
      className={sizeClass}
      onClick={() => deleteItem.mutate(item.id)}
      disabled={deleteItem.isPending}
    />
  );

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (itemsLoading) return <LineItemsLoading />;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Sizing: phone cards always get tall (h-11) inputs; the desktop table
  // bumps h-8 → h-10 on coarse pointers (tablets keep the table layout).
  const tableInputHeight = isTouch ? "h-10" : "h-8";

  return (
    <LineItemsEditorShell
      addLabel="Add Line Item"
      canAdd={!readOnly}
      addRow={addRow}
      buttonClassName={cn(isTouch && "min-h-[44px]")}
    >
      {isMobile ? (
        <div className="space-y-3">
          {items?.map((item) => (
            <div key={item.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 font-medium">{item.brand_name}</div>
                {!readOnly && renderDelete(item, "-mr-2 -mt-2 h-10 w-10 shrink-0")}
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Batch
                </span>
                <div>{renderBatch(item)}</div>
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Format
                </span>
                <div>{renderFormat(item)}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    Planned Qty
                  </span>
                  <div>{renderQty(item, "planned_quantity", "h-11")}</div>
                </div>
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    Actual Qty
                  </span>
                  <div>{renderQty(item, "actual_quantity", "h-11")}</div>
                </div>
              </div>
            </div>
          ))}

          {/* Empty state */}
          {(!items || items.length === 0) && !addRow.showAddRow && (
            <div className="rounded-lg border py-8 text-center text-muted-foreground">
              No line items yet. Click &quot;Add Line Item&quot; to add
              products to this packaging session.
            </div>
          )}

          {/* Totals */}
          {items && items.length > 0 && (
            <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3 text-sm">
              <span className="font-medium">Totals</span>
              <span>
                <span className="text-muted-foreground">Planned</span>{" "}
                <span className="font-bold">{totalPlanned}</span>
                {" · "}
                <span className="text-muted-foreground">Actual</span>{" "}
                <span className="font-bold">{totalActual}</span>
              </span>
            </div>
          )}

          {/* Quick-add reuses the table-row component; this branch only
              renders on phones (<768px), so the row's cells are stacked
              vertically via CSS — a 680px table forced horizontal panning
              at 390px (mobile-UX verification pass). */}
          {addRow.showAddRow && (
            <div className="rounded-lg border">
              <Table className="[&_thead]:hidden [&_tr]:flex [&_tr]:flex-col [&_tr]:gap-2 [&_tr]:border-0 [&_tbody_tr]:p-3 [&_td]:p-0">
                <TableHeader>
                  <TableRow>
                    <TableHead>Batch</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead className="w-[110px]">Planned</TableHead>
                    <TableHead className="w-[110px]">Actual</TableHead>
                    <TableHead className="w-[60px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <AddLineItemRow
                    newItem={newItem}
                    onChange={setNewItem}
                    onAdd={handleAdd}
                    isPending={addItem.isPending}
                  />
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Batch</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>Format</TableHead>
              <TableHead className="w-[120px]">Planned Qty</TableHead>
              <TableHead className="w-[120px]">Actual Qty</TableHead>
              {!readOnly && <TableHead className="w-[60px]" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items?.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{renderBatch(item)}</TableCell>

                <TableCell className="font-medium">{item.brand_name}</TableCell>

                <TableCell>{renderFormat(item)}</TableCell>

                <TableCell>
                  {renderQty(item, "planned_quantity", tableInputHeight)}
                </TableCell>

                <TableCell>
                  {renderQty(item, "actual_quantity", tableInputHeight)}
                </TableCell>

                {!readOnly && (
                  <TableCell>
                    {renderDelete(item, isTouch ? "h-10 w-10" : "h-8 w-8")}
                  </TableCell>
                )}
              </TableRow>
            ))}

            {/* Add new item row */}
            {addRow.showAddRow && (
              <AddLineItemRow
                newItem={newItem}
                onChange={setNewItem}
                onAdd={handleAdd}
                isPending={addItem.isPending}
              />
            )}

            {/* Empty state */}
            {(!items || items.length === 0) && !addRow.showAddRow && (
              <LineItemsEmptyRow colSpan={6}>
                No line items yet. Click &quot;Add Line Item&quot; to add
                products to this packaging session.
              </LineItemsEmptyRow>
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
      )}
    </LineItemsEditorShell>
  );
}
