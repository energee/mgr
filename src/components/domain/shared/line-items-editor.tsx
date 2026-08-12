"use client";

/**
 * Line Items Editor — shared state machine and shell for inline child-row editors.
 *
 * Four editors (order items, PO line items, transfer lines, packaging session
 * line items) render the same interaction shape: a "Line Items" heading with an
 * Add button that reveals an in-table add row, buffered per-cell numeric edits
 * committed on blur/Enter, a delete button per row, an empty-state row, and a
 * Cancel button below the table. This module owns that shape; the per-entity
 * columns, queries and mutations stay in each editor.
 *
 * What lives here:
 * - `useAddRow` — add-row visibility (open/close, with an optional reset on close).
 * - `useLineItemEdits` — the `Record<"<id>:<field>", string>` buffer plus the
 *   parse → skip-invalid → skip-unchanged → write commit rule.
 * - `LineItemEditInput` — an `Input` wired to that buffer (change/blur/Enter).
 * - `LineItemsEditorShell` — heading + Add button + Cancel footer around a table.
 * - `LineItemsLoading`, `LineItemsEmptyRow`, `LineItemsTotalFooter`,
 *   `AddLineButton`, `DeleteLineButton` — the repeated presentational atoms.
 *
 * Nothing here talks to Supabase or React Query: callers pass an `onCommit`
 * that performs the write, so mutation and invalidation semantics stay per-entity.
 */

import { useState, type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  TableCell,
  TableFooter,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

// =============================================================================
// Add-row visibility
// =============================================================================

/** Controls whether the in-table add row is shown. Created by `useAddRow`. */
export type AddRowController = {
  showAddRow: boolean;
  /** Reveals the add row. */
  open: () => void;
  /** Hides the add row and runs the caller's `onClose` reset, if any. */
  close: () => void;
};

/**
 * Owns add-row visibility.
 *
 * `onClose` runs on every close (Cancel button or a programmatic `close()`
 * after a successful insert), so editors that reset draft form state on cancel
 * declare that reset once here instead of duplicating it at both call sites.
 */
export function useAddRow(options?: { onClose?: () => void }): AddRowController {
  const [showAddRow, setShowAddRow] = useState(false);

  return {
    showAddRow,
    open: () => setShowAddRow(true),
    close: () => {
      setShowAddRow(false);
      options?.onClose?.();
    },
  };
}

// =============================================================================
// Buffered numeric edits on existing rows
// =============================================================================

/**
 * Buffered edits for existing rows, keyed by `${rowId}:${field}`.
 * Created by `useLineItemEdits`.
 */
export type LineItemEditsController<F extends string> = {
  /** Raw buffered string for a cell, or `undefined` when nothing is buffered. */
  valueFor: (id: string, field: F) => string | undefined;
  /** Buffers a keystroke without writing. */
  setEdit: (id: string, field: F, raw: string) => void;
  /**
   * Commits the buffered value for a cell. No-op when nothing was typed;
   * invalid input is dropped (the field reverts to `savedValue`) and an
   * unchanged value skips the write.
   */
  commit: (id: string, field: F, savedValue: number | null) => void;
};

/**
 * Owns the buffered-edit map so a controlled numeric cell issues one write per
 * committed edit instead of one per keystroke, and a mid-edit refetch cannot
 * snap the input back to the last-saved value.
 *
 * `parse` returns `null` for input that should revert (empty/NaN/out of range);
 * `onCommit` performs the actual write.
 */
export function useLineItemEdits<F extends string>({
  parse,
  onCommit,
}: {
  parse: (field: F, raw: string) => number | null;
  onCommit: (id: string, field: F, value: number) => void;
}): LineItemEditsController<F> {
  const [pendingEdits, setPendingEdits] = useState<Record<string, string>>({});

  const valueFor = (id: string, field: F) => pendingEdits[`${id}:${field}`];

  const setEdit = (id: string, field: F, raw: string) => {
    setPendingEdits((prev) => ({ ...prev, [`${id}:${field}`]: raw }));
  };

  const commit = (id: string, field: F, savedValue: number | null) => {
    const key = `${id}:${field}`;
    const raw = pendingEdits[key];
    if (raw === undefined) return; // nothing typed since the last commit
    setPendingEdits((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    const parsed = parse(field, raw);
    if (parsed === null) return; // revert to the saved value
    if (parsed === savedValue) return; // no-op — avoid the write
    onCommit(id, field, parsed);
  };

  return { valueFor, setEdit, commit };
}

type LineItemEditInputProps<F extends string> = Omit<
  ComponentProps<typeof Input>,
  "value" | "onChange" | "onBlur" | "onKeyDown"
> & {
  edits: LineItemEditsController<F>;
  /** Row id — half of the buffer key. */
  id: string;
  field: F;
  /** Value currently stored for this cell; shown whenever nothing is buffered. */
  savedValue: number | null;
};

/**
 * Numeric cell bound to a `useLineItemEdits` buffer: keystrokes buffer,
 * blur and Enter commit.
 */
export function LineItemEditInput<F extends string>({
  edits,
  id,
  field,
  savedValue,
  ...inputProps
}: LineItemEditInputProps<F>) {
  const commit = () => edits.commit(id, field, savedValue);
  return (
    <Input
      {...inputProps}
      value={edits.valueFor(id, field) ?? savedValue ?? ""}
      onChange={(e) => edits.setEdit(id, field, e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
  );
}

// =============================================================================
// Shell + presentational atoms
// =============================================================================

type LineItemsEditorShellProps = {
  /** Heading above the table. */
  title?: string;
  /** Label for the Add button (e.g. "Add Item", "Add Line"). */
  addLabel: string;
  /** Whether the Add button is offered at all (false in read-only/locked states). */
  canAdd: boolean;
  /** Disables the Add button while it is still shown (e.g. no source bin picked). */
  addDisabled?: boolean;
  addRow: AddRowController;
  /** Extra classes for the Add and Cancel buttons (touch-target sizing). */
  buttonClassName?: string;
  /** The table, plus anything else rendered between heading and Cancel. */
  children: ReactNode;
};

/**
 * Heading + Add button above the table and the Cancel button below it.
 * The table itself stays with the caller — column shapes differ per entity.
 */
export function LineItemsEditorShell({
  title = "Line Items",
  addLabel,
  canAdd,
  addDisabled,
  addRow,
  buttonClassName,
  children,
}: LineItemsEditorShellProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">{title}</h3>
        {canAdd && !addRow.showAddRow && (
          <Button
            size="sm"
            variant="outline"
            className={buttonClassName}
            onClick={addRow.open}
            disabled={addDisabled}
          >
            <Plus className="h-4 w-4 mr-2" />
            {addLabel}
          </Button>
        )}
      </div>

      {children}

      {addRow.showAddRow && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className={buttonClassName}
            onClick={addRow.close}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

/** Centered spinner shown while the line-item query is in flight. */
export function LineItemsLoading() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

/** Full-width "nothing here yet" row inside the table body. */
export function LineItemsEmptyRow({
  colSpan,
  children,
}: {
  colSpan: number;
  children: ReactNode;
}) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="text-center text-muted-foreground py-8">
        {children}
      </TableCell>
    </TableRow>
  );
}

/** Currency total row in the table footer (PO subtotal, order total). */
export function LineItemsTotalFooter({
  labelColSpan,
  label,
  amount,
  trailingCell = false,
}: {
  /** Columns the label spans before the amount cell. */
  labelColSpan: number;
  label: string;
  amount: number;
  /** Renders a trailing empty cell to line up with the actions column. */
  trailingCell?: boolean;
}) {
  return (
    <TableFooter>
      <TableRow>
        <TableCell colSpan={labelColSpan} className="text-right font-medium">
          {label}
        </TableCell>
        <TableCell className="text-right font-bold text-lg">
          ${amount.toFixed(2)}
        </TableCell>
        {trailingCell && <TableCell />}
      </TableRow>
    </TableFooter>
  );
}

/** Submit button in the add row; swaps to a spinner while the insert runs. */
export function AddLineButton({
  label,
  onClick,
  isPending,
  disabled,
}: {
  /** Accessible name, e.g. "Add line item". */
  label: string;
  onClick: () => void;
  isPending: boolean;
  /** Defaults to `isPending` when omitted. */
  disabled?: boolean;
}) {
  return (
    <Button
      size="icon"
      aria-label={label}
      className="h-8 w-8"
      onClick={onClick}
      disabled={disabled ?? isPending}
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Plus className="h-4 w-4" />
      )}
    </Button>
  );
}

/** Destructive trash button that removes a row. */
export function DeleteLineButton({
  label,
  onClick,
  disabled,
  className = "h-8 w-8",
}: {
  /** Accessible name, e.g. "Remove line item". */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Sizing/positioning classes; the destructive color is always applied. */
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      className={cn("text-destructive", className)}
      onClick={onClick}
      disabled={disabled}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}
