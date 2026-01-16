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
import { formatValue } from "@/lib/utils";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Filter,
  MoreHorizontal,
  Plus,
  Search,
  X,
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

  // Quick filter state - maps field name to selected value(s)
  const [quickFilters, setQuickFilters] = useState<Record<string, string | string[]>>({});

  // Fetch data - use viewTable if available (for views with joins), otherwise use base table
  const fetchTable = entity.viewTable || entity.table;
  const { data, isLoading, error } = useQuery({
    queryKey: [fetchTable, filters, quickFilters],
    queryFn: async () => {
      let query = db.from(fetchTable).select("*");

      // Apply additional filters (from props)
      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          query = query.eq(key, value);
        });
      }

      // Apply quick filters from UI
      Object.entries(quickFilters).forEach(([field, value]) => {
        if (value === "" || value === undefined || (Array.isArray(value) && value.length === 0)) return;

        // Find the filter definition to determine the type
        const filterDef = entity.listFilters?.find((f) => f.field === field);

        if (Array.isArray(value)) {
          // Multiselect filter - use "in" operator
          query = query.in(field, value);
        } else if (filterDef?.type === "search") {
          // Search filter - use ilike for partial matching
          query = query.ilike(field, `%${value}%`);
        } else if (value === "true" || value === "false") {
          // Boolean filter
          query = query.eq(field, value === "true");
        } else {
          // Single value filter
          query = query.eq(field, value);
        }
      });

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

        // Use shared formatValue utility
        return formatValue(value, col.format);
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

  // Check if any quick filters are active
  const hasActiveQuickFilters = Object.values(quickFilters).some((v) =>
    v !== "" && v !== undefined && !(Array.isArray(v) && v.length === 0)
  );
  const hasActiveFilters = globalFilter || hasActiveQuickFilters;

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

      {/* Search and Filters */}
      <div className="flex flex-wrap items-center gap-4">
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

        {/* Quick Filters */}
        {entity.listFilters && entity.listFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            {entity.listFilters.map((filter) => (
              <div key={filter.field} className="min-w-[140px]">
                {filter.type === "select" && filter.options && (
                  <Select
                    value={(quickFilters[filter.field] as string) || ""}
                    onValueChange={(value) =>
                      setQuickFilters((prev) => ({
                        ...prev,
                        [filter.field]: value,
                      }))
                    }
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder={filter.label} />
                    </SelectTrigger>
                    <SelectContent>
                      {filter.options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {/* Multiselect with checkboxes */}
                {filter.type === "multiselect" && filter.options && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 border-dashed text-sm font-normal"
                      >
                        <Filter className="mr-2 h-4 w-4" />
                        {filter.label}
                        {(quickFilters[filter.field] as string[])?.length > 0 && (
                          <>
                            <div className="mx-2 h-4 w-px bg-border" />
                            <Badge
                              variant="secondary"
                              className="rounded-sm px-1 font-normal"
                            >
                              {(quickFilters[filter.field] as string[]).length}
                            </Badge>
                          </>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[200px] p-0" align="start">
                      <div className="max-h-64 overflow-auto">
                        {filter.options.map((option) => {
                          const isSelected = (
                            quickFilters[filter.field] as string[] || []
                          ).includes(option.value);
                          return (
                            <div
                              key={option.value}
                              className="flex items-center space-x-2 px-3 py-2 hover:bg-accent cursor-pointer"
                              onClick={() => {
                                const currentValues =
                                  (quickFilters[filter.field] as string[]) || [];
                                const newValues = isSelected
                                  ? currentValues.filter((v) => v !== option.value)
                                  : [...currentValues, option.value];
                                setQuickFilters((prev) => ({
                                  ...prev,
                                  [filter.field]: newValues,
                                }));
                              }}
                            >
                              <Checkbox checked={isSelected} />
                              <span className="text-sm">{option.label}</span>
                            </div>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
                {/* Search filter as text input */}
                {filter.type === "search" && (
                  <Input
                    placeholder={filter.label}
                    value={(quickFilters[filter.field] as string) || ""}
                    onChange={(e) =>
                      setQuickFilters((prev) => ({
                        ...prev,
                        [filter.field]: e.target.value,
                      }))
                    }
                    className="h-9 w-36"
                  />
                )}
                {filter.type === "boolean" && (
                  <Select
                    value={(quickFilters[filter.field] as string) || ""}
                    onValueChange={(value) =>
                      setQuickFilters((prev) => ({
                        ...prev,
                        [filter.field]: value,
                      }))
                    }
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder={filter.label} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">All</SelectItem>
                      <SelectItem value="true">Yes</SelectItem>
                      <SelectItem value="false">No</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            ))}
            {/* Clear filters button */}
            {hasActiveQuickFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setQuickFilters({})}
                className="h-9"
              >
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Active filter badges */}
      {hasActiveQuickFilters && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(quickFilters).map(([field, value]) => {
            if (value === "" || value === undefined || (Array.isArray(value) && value.length === 0)) return null;
            const filterDef = entity.listFilters?.find((f) => f.field === field);
            if (!filterDef) return null;

            const getLabel = (val: string | string[]) => {
              if (Array.isArray(val)) {
                // Multiselect - show comma-separated labels
                return val
                  .map((v) => {
                    const option = filterDef.options?.find((o) => o.value === v);
                    return option?.label || v;
                  })
                  .join(", ");
              }
              if (filterDef.type === "boolean") {
                return val === "true" ? "Yes" : "No";
              }
              if (filterDef.type === "search") {
                return `"${val}"`;
              }
              const option = filterDef.options?.find((o) => o.value === val);
              return option?.label || val;
            };

            return (
              <Badge key={field} variant="secondary" className="text-xs">
                {filterDef.label}: {getLabel(value as string | string[])}
                <button
                  type="button"
                  className="ml-1 hover:text-destructive"
                  onClick={() =>
                    setQuickFilters((prev) => ({
                      ...prev,
                      [field]: Array.isArray(value) ? [] : "",
                    }))
                  }
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
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
              // Empty state with helpful prompt
              <TableRow>
                <TableCell colSpan={columnsWithActions.length} className="h-48">
                  <div className="flex flex-col items-center justify-center gap-3 text-center py-8">
                    <div className="text-muted-foreground">
                      {hasActiveFilters ? (
                        <>
                          <p className="font-medium">No matching {entity.displayNamePlural.toLowerCase()}</p>
                          <p className="text-sm">Try adjusting your search or filters</p>
                        </>
                      ) : (
                        <>
                          <p className="font-medium">No {entity.displayNamePlural.toLowerCase()} yet</p>
                          <p className="text-sm">Get started by creating your first {entity.displayName.toLowerCase()}</p>
                        </>
                      )}
                    </div>
                    {showCreate && !hasActiveFilters && (
                      onCreateClick ? (
                        <Button size="sm" onClick={onCreateClick}>
                          <Plus className="h-4 w-4 mr-1" />
                          Create {entity.displayName}
                        </Button>
                      ) : (
                        <Button size="sm" asChild>
                          <Link href={`${path}/new`}>
                            <Plus className="h-4 w-4 mr-1" />
                            Create {entity.displayName}
                          </Link>
                        </Button>
                      )
                    )}
                  </div>
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
