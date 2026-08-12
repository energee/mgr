"use client";

/**
 * sortable-rows — the shared primitive behind every drag-to-reorder row editor
 * (grain bill, hop schedule, mash schedule, fermentation schedule, batch
 * additions).
 *
 * Each of those editors is a controlled `{ items, onChange }` component that
 * re-implemented the same four things: a mutation kernel (append / patch one
 * row / remove-and-renumber / reorder-and-renumber), a one-shot ID backfill for
 * legacy rows saved before drag-and-drop needed stable keys, the
 * `Sortable`→`Table`→`SortableContent` scaffold with a drag-overlay, and the
 * grip/trash cells that bracket every row. Only the row *body* differs per
 * domain, so that is the one thing callers still supply.
 *
 * - `useSortableRows` — the mutation kernel + ID backfill.
 * - `SortableRows` — the scaffold, in two shapes selected by whether `columns`
 *   is supplied: a `<Table>` under those headers, or a stack of cards (used by
 *   the fermentation editor, whose rows are collapsibles rather than table
 *   rows).
 * - `SortableRowHandle` / `RemoveRowButton` — the bracketing controls.
 *
 * Behavior is deliberately identical to what the five editors did before
 * extraction; the characterization tests under
 * `src/components/domain/{recipe,batch}/__tests__/` pin it per editor, and
 * `__tests__/sortable-rows.test.tsx` pins the kernel and the one-shot backfill
 * directly.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Sortable,
  SortableContent,
  SortableItem,
  SortableItemHandle,
  SortableOverlay,
} from "@/components/ui/sortable";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { GripVertical, Trash2 } from "lucide-react";

/** Minimum shape a sortable row must have: a stable key and an ordinal. */
export type SortableRow = {
  id?: string;
  position: number;
};

/**
 * Re-stamp `position` to match array order. Every mutation funnels through
 * this, and it stays module-private so no caller can renumber outside the
 * kernel and drift from it.
 */
function reorderWithPositions<T extends { position?: number }>(items: T[]): T[] {
  return items.map((item, i) => ({ ...item, position: i }));
}

type UseSortableRowsOptions<T> = {
  items: T[];
  onChange: (items: T[]) => void;
  /**
   * ID factory used to backfill rows persisted before IDs were required.
   * Omit to skip backfill entirely (for editors whose rows are keyed by a
   * foreign key rather than an own `id`).
   */
  generateId?: () => string;
};

export type SortableRowsApi<T> = {
  /** Append `row` with `position` already set to the current length. */
  append: (row: Omit<T, "position">) => void;
  /** Shallow-merge `patch` into row `index`. */
  update: (index: number, patch: Partial<T>) => void;
  /** Set a single field on row `index`. */
  updateField: <K extends keyof T>(index: number, field: K, value: T[K]) => void;
  /** Drop row `index` and renumber the survivors. */
  remove: (index: number) => void;
  /** Accept a dragged order and renumber. */
  reorder: (reordered: T[]) => void;
};

/**
 * The mutation kernel shared by all row editors.
 *
 * The ID backfill runs at most once per mount (guarded by a ref) because
 * `onChange` frequently has an unstable identity in the recipe/batch forms —
 * without the guard the effect would re-fire on every parent render and
 * regenerate IDs mid-drag.
 */
export function useSortableRows<T extends SortableRow>({
  items,
  onChange,
  generateId,
}: UseSortableRowsOptions<T>): SortableRowsApi<T> {
  const backfilledRef = useRef(false);
  useEffect(() => {
    if (!generateId || backfilledRef.current) return;
    backfilledRef.current = true;
    if (items.some((item) => !item.id)) {
      onChange(items.map((item) => (item.id ? item : { ...item, id: generateId() })));
    }
  }, [items, onChange, generateId]);

  const append = useCallback(
    (row: Omit<T, "position">) => {
      onChange([...items, { ...row, position: items.length } as T]);
    },
    [items, onChange],
  );

  const update = useCallback(
    (index: number, patch: Partial<T>) => {
      const updated = [...items];
      updated[index] = { ...updated[index], ...patch };
      onChange(updated);
    },
    [items, onChange],
  );

  const updateField = useCallback(
    <K extends keyof T>(index: number, field: K, value: T[K]) => {
      // A computed-key object literal widens to `{ [x: string]: T[K] }`, which
      // TS cannot relate to `Partial<T>` without the double assertion.
      update(index, { [field]: value } as unknown as Partial<T>);
    },
    [update],
  );

  const remove = useCallback(
    (index: number) => {
      onChange(reorderWithPositions(items.filter((_, i) => i !== index)));
    },
    [items, onChange],
  );

  const reorder = useCallback(
    (reordered: T[]) => onChange(reorderWithPositions(reordered)),
    [onChange],
  );

  return useMemo(
    () => ({ append, update, updateField, remove, reorder }),
    [append, update, updateField, remove, reorder],
  );
}

/** The grip control that starts a drag. Identical in every editor. */
export function SortableRowHandle() {
  return (
    <SortableItemHandle className="p-1 hover:bg-muted rounded touch-none">
      <GripVertical className="h-4 w-4 text-muted-foreground" />
    </SortableItemHandle>
  );
}

/** The trailing trash control. Identical in every editor. */
export function RemoveRowButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

/** The drag-follows-cursor card shown while a row is lifted. */
export function SortableDragPreview({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 shadow-sm">
      <GripVertical className="h-4 w-4 text-muted-foreground" />
      <span className="font-medium">{title}</span>
      {subtitle && <span className="text-sm text-muted-foreground">{subtitle}</span>}
    </div>
  );
}

/** A column definition for the table shape. */
export type SortableRowsColumn = {
  /** Header text; omit for the grip and trash gutters. */
  label?: string;
  className?: string;
};

type SortableRowsProps<T> = {
  items: T[];
  onReorder: (reordered: T[]) => void;
  /** Stable drag key per row. Defaults to `item.id`. */
  getItemValue?: (item: T) => string;
  disabled?: boolean;
  /** Rendered instead of the list when `items` is empty. */
  empty: React.ReactNode;
  /** Row body — a `<TableRow>` in the table shape, a card in the stack shape. */
  children: (item: T, index: number) => React.ReactNode;
  /** Contents of the drag overlay for the row currently being dragged. */
  overlay?: (item: T | undefined) => React.ReactNode;
  /** Rendered after the list, inside the `Sortable` (e.g. a totals bar). */
  footer?: React.ReactNode;
  /**
   * Table headers. Supplying them selects the table shape, in which `children`
   * must return a `<TableRow>` and `footer` a `<TableFooter>`; omitting them
   * selects the stack shape, where both are plain nodes.
   */
  columns?: SortableRowsColumn[];
};

/**
 * The `Sortable` scaffold: empty state, drag context, list container, and drag
 * overlay. With `columns`, rows are wrapped in a `<Table>` under those headers
 * with an optional `<TableFooter>`-shaped `footer`; without, they render as a
 * vertical stack of cards with `footer` below.
 */
export function SortableRows<T extends SortableRow>({
  items,
  onReorder,
  getItemValue,
  disabled = false,
  empty,
  children,
  overlay,
  footer,
  columns,
}: SortableRowsProps<T>) {
  if (items.length === 0) return <>{empty}</>;

  const itemValue = getItemValue ?? ((item: T) => item.id!);

  const rows = items.map((item, index) => (
    <SortableItem key={itemValue(item)} value={itemValue(item)} asChild disabled={disabled}>
      {children(item, index)}
    </SortableItem>
  ));

  return (
    <Sortable<T> value={items} onValueChange={onReorder} getItemValue={itemValue}>
      {columns ? (
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col, i) => (
                <TableHead key={i} className={col.className}>
                  {col.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <SortableContent asChild>
            <TableBody>{rows}</TableBody>
          </SortableContent>
          {footer}
        </Table>
      ) : (
        <>
          <SortableContent asChild>
            <div className="space-y-2">{rows}</div>
          </SortableContent>
          {footer}
        </>
      )}
      {overlay && (
        <SortableOverlay>
          {({ value }) => <>{overlay(items.find((i) => itemValue(i) === value))}</>}
        </SortableOverlay>
      )}
    </Sortable>
  );
}

/** Convenience: the leading grip `<TableCell>` used by every table-shaped editor. */
export function SortableHandleCell() {
  return (
    <TableCell>
      <SortableRowHandle />
    </TableCell>
  );
}

/** Convenience: the trailing trash `<TableCell>` used by every table-shaped editor. */
export function RemoveRowCell({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <TableCell>
      <RemoveRowButton onClick={onClick} disabled={disabled} />
    </TableCell>
  );
}
