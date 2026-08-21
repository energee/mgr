"use client";

/**
 * MobileFilterSheet - mobile entry point for advanced filters + sorting.
 *
 * Extracted verbatim from entity-data-table.tsx (B10 mono-file split);
 * behavior is unchanged. Rendered by EntityDataTable below the mobile
 * breakpoint in place of the desktop advanced toolbar.
 */

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SlidersHorizontal } from "lucide-react";
import { DataTableFilterList } from "@/components/data-table/data-table-filter-list";
import { DataTableSortList } from "@/components/data-table/data-table-sort-list";
import type { Table as TanstackTable } from "@tanstack/react-table";
import type { ExtendedColumnFilter } from "@/types/data-table";

/**
 * Mobile entry point for advanced filters + sorting (audit 10.3). The desktop
 * toolbar (DataTableAdvancedToolbar) only renders alongside the table view, so
 * below the mobile breakpoint this exposes the same DataTableFilterList /
 * DataTableSortList — bound to the same table instance and nuqs URL state —
 * inside a bottom sheet. The trigger shows an active-filter count badge.
 */
export function MobileFilterSheet<TData>({
  table,
  activeFilterCount,
  defaultFilters,
}: {
  table: TanstackTable<TData>;
  activeFilterCount: number;
  /** Passed through to DataTableFilterList — see its prop doc. */
  defaultFilters?: ExtendedColumnFilter<TData>[];
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative ml-auto size-10 shrink-0"
          aria-label={
            activeFilterCount > 0
              ? `Filters and sorting (${activeFilterCount} active)`
              : "Filters and sorting"
          }
        >
          <SlidersHorizontal className="h-4 w-4" />
          {activeFilterCount > 0 && (
            <Badge className="absolute -right-1.5 -top-1.5 h-4 min-w-4 rounded-full px-1 text-[10px]">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[80svh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>Filters &amp; sorting</SheetTitle>
          <SheetDescription>
            Changes apply to the list immediately.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col items-start gap-3 px-4 pb-6">
          <DataTableFilterList table={table} defaultFilters={defaultFilters} />
          <DataTableSortList table={table} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
