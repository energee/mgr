import { flexRender, type Table as TanstackTable } from "@tanstack/react-table";
import Link from "next/link";
import type * as React from "react";

import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getColumnPinningStyle } from "@/lib/data-table";
import { NON_NAVIGABLE_COLUMN_IDS } from "@/components/data-table/adapter";
import { cn } from "@/lib/utils";

type DataTableProps<TData> = React.ComponentProps<"div"> & {
  table: TanstackTable<TData>;
  actionBar?: React.ReactNode;
  noResultsContent?: React.ReactNode;
  /** Called when a row is clicked (excluding select checkboxes and action menu cells) */
  onRowClick?: (row: TData) => void;
  /**
   * When set, each row's first navigable cell wraps its content in a real
   * `<Link>` so keyboard/screen-reader users get a focusable, announced
   * navigation target (audit A11Y-1 — the desktop counterpart of
   * entity-mobile-card-list's Link pattern). Mouse users keep the whole-row
   * click via `onRowClick`; the cell click handler already ignores clicks
   * inside anchors, so the two paths don't double-navigate. Return null to
   * skip a row (e.g. missing id).
   */
  getRowHref?: (row: TData) => string | null;
}

export function DataTable<TData>({
  table,
  actionBar,
  noResultsContent,
  onRowClick,
  getRowHref,
  children,
  className,
  ...props
}: DataTableProps<TData>) {
  return (
    <div
      className={cn("flex w-full flex-col gap-2.5 overflow-auto", className)}
      {...props}
    >
      {children}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    style={getColumnPinningStyle({ column: header.column })}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => {
                const rowHref = getRowHref?.(row.original) ?? null;
                // First non-select/actions cell hosts the row's keyboard
                // navigation Link (audit A11Y-1).
                const primaryCellId = rowHref
                  ? row
                      .getVisibleCells()
                      .find(
                        (c) =>
                          !NON_NAVIGABLE_COLUMN_IDS.includes(
                            c.column.id as (typeof NON_NAVIGABLE_COLUMN_IDS)[number],
                          ),
                      )?.column.id
                  : undefined;
                return (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                    className={cn(onRowClick && "cursor-pointer")}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const isExcluded = NON_NAVIGABLE_COLUMN_IDS.includes(
                        cell.column.id as (typeof NON_NAVIGABLE_COLUMN_IDS)[number],
                      );
                      const content = flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      );
                      return (
                        <TableCell
                          key={cell.id}
                          style={getColumnPinningStyle({ column: cell.column })}
                          onClick={
                            onRowClick && !isExcluded
                              ? (e) => {
                                  if ((e.target as HTMLElement).closest("a, button")) return;
                                  onRowClick(row.original);
                                }
                              : undefined
                          }
                        >
                          {rowHref && cell.column.id === primaryCellId ? (
                            <Link
                              href={rowHref}
                              className="hover:underline focus-visible:underline"
                            >
                              {content}
                            </Link>
                          ) : (
                            content
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={table.getAllColumns().length}
                  className="h-24 text-center"
                >
                  {noResultsContent ?? "No results."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-col gap-2.5">
        <DataTablePagination table={table} />
        {actionBar &&
          table.getFilteredSelectedRowModel().rows.length > 0 &&
          actionBar}
      </div>
    </div>
  );
}
