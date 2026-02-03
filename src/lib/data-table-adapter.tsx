"use client";

/**
 * Data Table Adapter
 *
 * Translates EntityConfig definitions → Dice UI DataTable columns with meta.
 * Pure translation layer — no entity config changes needed.
 */

import type { ColumnDef } from "@tanstack/react-table";
import type {
  EntityConfig,
  EntityColumnDef,
  EntityFilterDef,
} from "@/types/entity";
import type { FilterVariant, Option } from "@/types/data-table";
import { formatValue } from "@/lib/utils";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { MoreHorizontal } from "lucide-react";

// =============================================================================
// Filter Variant Mapping
// =============================================================================

/**
 * Maps EntityFilterDef.type → Dice UI FilterVariant
 */
function toFilterVariant(
  filterType: EntityFilterDef["type"]
): FilterVariant {
  const map: Record<EntityFilterDef["type"], FilterVariant> = {
    select: "select",
    multiselect: "multiSelect",
    search: "text",
    boolean: "boolean",
    date: "date",
    daterange: "dateRange",
  };
  return map[filterType];
}

// =============================================================================
// buildDataTableColumns
// =============================================================================

/**
 * Maps EntityColumnDef[] + EntityFilterDef[] → Dice UI ColumnDef[] with meta.
 * Joins filters onto matching columns by field name.
 */
export function buildDataTableColumns<T>(
  entity: EntityConfig<T>,
  dynamicFilterOptions: Record<string, { value: string; label: string }[]>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): ColumnDef<T, any>[] {
  const filtersByField = new Map<string, EntityFilterDef>();
  entity.listFilters?.forEach((f) => filtersByField.set(f.field, f));

  return entity.listColumns.map((col: EntityColumnDef<T>) => {
    const accessorKey = col.accessorKey as string | undefined;
    const filter = accessorKey ? filtersByField.get(accessorKey) : undefined;

    // Build options from filter definition
    let options: Option[] | undefined;
    if (filter) {
      const rawOptions =
        dynamicFilterOptions[filter.field] || filter.options || [];
      options = rawOptions.map((opt) => ({
        label: opt.label,
        value: opt.value,
      }));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const column: ColumnDef<T, any> = {
      id: accessorKey || col.id,
      ...(accessorKey
        ? { accessorKey: accessorKey as keyof T & string }
        : {}),
      header: col.header,
      enableSorting: col.sortable !== false,
      enableColumnFilter: !!filter,
      meta: {
        label: typeof col.header === "string" ? col.header : accessorKey || "",
        ...(filter ? { variant: toFilterVariant(filter.type) } : {}),
        ...(options && options.length > 0 ? { options } : {}),
      },
      cell: ({ row }: { row: { getValue: (id: string) => unknown; original: T } }) => {
        const value = accessorKey ? row.getValue(accessorKey) : null;

        // Custom render function from entity config
        if (col.render) {
          return col.render(value, row.original);
        }

        // Use shared formatValue utility
        return formatValue(value, col.format);
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any as ColumnDef<T, any>;

    return column;
  });
}

// =============================================================================
// buildSelectColumn
// =============================================================================

/**
 * Creates the row selection checkbox column for bulk actions.
 */
export function buildSelectColumn<T>(): ColumnDef<T, unknown> {
  return {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) =>
          table.toggleAllPageRowsSelected(!!value)
        }
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
      />
    ),
    enableSorting: false,
    enableHiding: false,
    enableColumnFilter: false,
    size: 40,
  };
}

// =============================================================================
// buildActionsColumn
// =============================================================================

/**
 * Creates the row actions dropdown column (View, Edit, state transitions, custom actions).
 */
export function buildActionsColumn<T>(
  entity: EntityConfig<T>,
  basePath: string,
  onAction?: (actionName: string, record: T) => boolean
): ColumnDef<T, unknown> {
  return {
    id: "actions",
    enableSorting: false,
    enableHiding: false,
    enableColumnFilter: false,
    size: 40,
    cell: ({ row }) => {
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
              <Link href={`${basePath}/${id}`}>View</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`${basePath}/${id}/edit`}>Edit</Link>
            </DropdownMenuItem>
            {entity.actions?.map((action) => {
              if (action.showWhen && !action.showWhen(record)) return null;
              if (action.fromStates) {
                const stateField = entity.stateMachine?.stateField;
                const currentState = stateField
                  ? ((record as Record<string, unknown>)[
                      stateField
                    ] as string)
                  : null;
                if (
                  !currentState ||
                  !action.fromStates.includes(currentState)
                )
                  return null;
              }
              return (
                <DropdownMenuItem
                  key={action.name}
                  onClick={() => {
                    if (onAction && onAction(action.name, record)) {
                      return;
                    }
                    action.handler?.(record);
                  }}
                >
                  {action.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  };
}

// =============================================================================
// buildSupabaseFilters
// =============================================================================

/**
 * Translates Dice UI ColumnFiltersState into Supabase query operations.
 *
 * Each filter in the state has:
 * - id: column/field name
 * - value: string | string[] (depends on filter variant)
 *
 * Returns a function that applies all filters to a Supabase query builder.
 */
export function buildSupabaseFilters(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columnFilters: { id: string; value: any }[],
  filterDefs: EntityFilterDef[]
) {
  const filterDefMap = new Map<string, EntityFilterDef>();
  filterDefs.forEach((f) => filterDefMap.set(f.field, f));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (query: any) => {
    for (const filter of columnFilters) {
      const value = filter.value;
      if (
        value === undefined ||
        value === null ||
        value === "" ||
        (Array.isArray(value) && value.length === 0)
      )
        continue;

      const def = filterDefMap.get(filter.id);
      const filterType = def?.type;

      if (Array.isArray(value)) {
        // Multiselect — use .in() operator
        query = query.in(filter.id, value);
      } else if (filterType === "search") {
        // Text search — use ilike
        query = query.ilike(filter.id, `%${value}%`);
      } else if (filterType === "boolean") {
        // Boolean
        query = query.eq(filter.id, value === "true" || value === true);
      } else {
        // Single value — select or fallback
        query = query.eq(filter.id, value);
      }
    }

    return query;
  };
}
