"use client";

/**
 * EntityList - Universal List Component
 *
 * Renders a data table for any entity based on its configuration.
 * Handles: fetching, filtering, sorting, pagination, and actions.
 *
 * Uses TanStack Table for headless table functionality and
 * TanStack Virtual for virtualizing large lists.
 */

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type SortingState,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { EntityConfig, EntityColumnDef } from "@/types/entity";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  MoreHorizontal,
  Plus,
  Search,
} from "lucide-react";

interface EntityListProps<T = Record<string, unknown>> {
  /** Entity configuration */
  entity: EntityConfig<T>;
  /** Base path for detail links (defaults to entity name) */
  basePath?: string;
  /** Additional query filters */
  filters?: Record<string, unknown>;
  /** Whether to show create button */
  showCreate?: boolean;
  /** Custom create handler (instead of link) */
  onCreateClick?: () => void;
}

export function EntityList<T = Record<string, unknown>>({
  entity,
  basePath,
  filters,
  showCreate = true,
  onCreateClick,
}: EntityListProps<T>) {
  const supabase = createClient();
  // Cast to any for dynamic table access - universal components work with any entity
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const path = basePath || `/${entity.domain}/${entity.name}s`;

  // Table state
  const [sorting, setSorting] = useState<SortingState>(
    entity.defaultSort
      ? [{ id: entity.defaultSort.column, desc: entity.defaultSort.direction === "desc" }]
      : []
  );
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  // Fetch data
  const { data, isLoading, error } = useQuery({
    queryKey: [entity.table, filters],
    queryFn: async () => {
      let query = db.from(entity.table).select("*");

      // Apply additional filters
      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          query = query.eq(key, value);
        });
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as T[];
    },
  });

  // Build columns from entity config
  const columns = useMemo(() => {
    return entity.listColumns.map((col) => ({
      ...col,
      cell: ({ row }: { row: { original: T; getValue: (id: string) => unknown } }) => {
        const value = col.accessorKey ? row.getValue(col.accessorKey) : null;

        // Custom render function
        if (col.render) {
          return col.render(value, row.original);
        }

        // Format helpers
        if (col.format) {
          switch (col.format) {
            case "date":
              return value ? new Date(value as string).toLocaleDateString() : "—";
            case "datetime":
              return value ? new Date(value as string).toLocaleString() : "—";
            case "currency":
              return value != null ? `$${(value as number).toFixed(2)}` : "—";
            case "number":
              return value != null ? (value as number).toLocaleString() : "—";
            case "percentage":
              return value != null ? `${value}%` : "—";
          }
        }

        // Default rendering
        if (value === null || value === undefined) return "—";
        if (typeof value === "boolean") return value ? "Yes" : "No";
        return String(value);
      },
    }));
  }, [entity.listColumns]);

  // Add actions column
  const columnsWithActions = useMemo(() => {
    return [
      ...columns,
      {
        id: "actions",
        cell: ({ row }: { row: { original: T } }) => {
          const record = row.original;
          const id = (record as Record<string, unknown>).id as string;

          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={`${path}/${id}`}>View</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`${path}/${id}/edit`}>Edit</Link>
                </DropdownMenuItem>
                {entity.actions?.map((action) => {
                  if (action.showWhen && !action.showWhen(record)) return null;
                  return (
                    <DropdownMenuItem
                      key={action.name}
                      onClick={() => action.handler?.(record)}
                    >
                      {action.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ];
  }, [columns, entity.actions, path]);

  // Initialize table
  const table = useReactTable({
    data: data || [],
    columns: columnsWithActions,
    state: {
      sorting,
      columnFilters,
      globalFilter,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  if (error) {
    return (
      <div className="text-center py-8 text-destructive">
        Failed to load {entity.displayNamePlural.toLowerCase()}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{entity.displayNamePlural}</h1>
          <p className="text-muted-foreground">{entity.description}</p>
        </div>
        {showCreate && (
          <Button asChild={!onCreateClick} onClick={onCreateClick}>
            {onCreateClick ? (
              <>
                <Plus className="h-4 w-4 mr-2" />
                New {entity.displayName}
              </>
            ) : (
              <Link href={`${path}/new`}>
                <Plus className="h-4 w-4 mr-2" />
                New {entity.displayName}
              </Link>
            )}
          </Button>
        )}
      </div>

      {/* Search */}
      {entity.searchableFields && entity.searchableFields.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={`Search ${entity.displayNamePlural.toLowerCase()}...`}
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-10"
          />
        </div>
      )}

      {/* Table */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const colDef = header.column.columnDef as EntityColumnDef<T>;
                  const canSort = colDef.sortable !== false;

                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : (
                        <div
                          className={canSort ? "flex items-center gap-2 cursor-pointer select-none" : ""}
                          onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {canSort && (
                            <span className="text-muted-foreground">
                              {header.column.getIsSorted() === "asc" ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : header.column.getIsSorted() === "desc" ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronsUpDown className="h-4 w-4" />
                              )}
                            </span>
                          )}
                        </div>
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              // Loading skeleton
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {columns.map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                  <TableCell>
                    <Skeleton className="h-8 w-8" />
                  </TableCell>
                </TableRow>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              // Empty state
              <TableRow>
                <TableCell colSpan={columnsWithActions.length} className="h-24 text-center">
                  No {entity.displayNamePlural.toLowerCase()} found.
                </TableCell>
              </TableRow>
            ) : (
              // Data rows
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {!isLoading && data && data.length > 10 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {table.getRowModel().rows.length} of {data.length} results
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
