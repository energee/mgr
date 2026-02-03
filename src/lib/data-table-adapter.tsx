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
import type { FilterVariant, Option, ExtendedColumnFilter } from "@/types/data-table";
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

    return {
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

        if (col.render) {
          return col.render(value, row.original);
        }

        return formatValue(value, col.format);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as ColumnDef<T, any>;
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
// Input Escaping
// =============================================================================

/** Escape SQL LIKE wildcards for use in ilike queries */
export function escapeLikeValue(value: string): string {
  return value.replace(/[%_\\]/g, (c) => `\\${c}`);
}

/** Escape special characters for PostgREST .or() filter strings */
export function escapePostgrestOrValue(value: string): string {
  return value.replace(/[%_\\,().]/g, (c) => `\\${c}`);
}

// =============================================================================
// buildSupabaseFiltersFromUrl
// =============================================================================

/**
 * Translates nuqs ExtendedColumnFilter[] (from DataTableFilterList URL state)
 * into Supabase query operations.
 *
 * Each filter has: { id, value, operator, variant, filterId }
 * Operators: iLike, notILike, eq, ne, inArray, notInArray, lt, lte, gt, gte,
 *            isEmpty, isNotEmpty, isBetween
 */
export function buildSupabaseFiltersFromUrl<T>(
  urlFilters: ExtendedColumnFilter<T>[],
  joinOperator: "and" | "or" = "and"
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (query: any) => {
    if (urlFilters.length === 0) return query;

    // When using "or" join, we need to build an .or() string
    if (joinOperator === "or") {
      const conditions = urlFilters
        .map((filter) => buildPostgrestCondition(filter))
        .filter(Boolean);
      if (conditions.length > 0) {
        query = query.or(conditions.join(","));
      }
      return query;
    }

    // "and" join: apply each filter sequentially
    for (const filter of urlFilters) {
      query = applyFilterToQuery(query, filter);
    }
    return query;
  };
}

/** Apply a single filter to a Supabase query (for "and" mode) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilterToQuery(query: any, filter: ExtendedColumnFilter<any>) {
  const { id, value, operator } = filter;
  if (value === undefined || value === null || value === "") {
    if (operator !== "isEmpty" && operator !== "isNotEmpty") return query;
  }

  switch (operator) {
    case "iLike":
      return query.ilike(id, `%${escapeLikeValue(String(value))}%`);
    case "notILike":
      return query.not(id, "ilike", `%${escapeLikeValue(String(value))}%`);
    case "eq":
      return query.eq(id, value);
    case "ne":
      return query.neq(id, value);
    case "inArray":
      return query.in(id, Array.isArray(value) ? value : [value]);
    case "notInArray": {
      const arr = Array.isArray(value) ? value : [value];
      // PostgREST: negate an in check
      for (const v of arr) {
        query = query.neq(id, v);
      }
      return query;
    }
    case "lt":
      return query.lt(id, value);
    case "lte":
      return query.lte(id, value);
    case "gt":
      return query.gt(id, value);
    case "gte":
      return query.gte(id, value);
    case "isEmpty":
      return query.is(id, null);
    case "isNotEmpty":
      return query.not(id, "is", null);
    case "isBetween": {
      if (Array.isArray(value) && value.length === 2) {
        return query.gte(id, value[0]).lte(id, value[1]);
      }
      return query;
    }
    default:
      return query.eq(id, value);
  }
}

/** Build a PostgREST condition string for .or() usage */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPostgrestCondition(filter: ExtendedColumnFilter<any>): string | null {
  const { id, value, operator } = filter;
  if (value === undefined || value === null || value === "") {
    if (operator !== "isEmpty" && operator !== "isNotEmpty") return null;
  }

  switch (operator) {
    case "iLike":
      return `${id}.ilike.%${escapePostgrestOrValue(String(value))}%`;
    case "notILike":
      return `${id}.not.ilike.%${escapePostgrestOrValue(String(value))}%`;
    case "eq":
      return `${id}.eq.${escapePostgrestOrValue(String(value))}`;
    case "ne":
      return `${id}.neq.${escapePostgrestOrValue(String(value))}`;
    case "inArray": {
      const arr = Array.isArray(value) ? value : [value];
      return `${id}.in.(${arr.map((v) => escapePostgrestOrValue(String(v))).join(",")})`;
    }
    case "notInArray": {
      const arr = Array.isArray(value) ? value : [value];
      // PostgREST doesn't have a direct "not in" - use multiple neq joined with and
      // For or() context, this returns multiple conditions that should be anded
      return arr.map((v) => `${id}.neq.${escapePostgrestOrValue(String(v))}`).join(",");
    }
    case "lt":
      return `${id}.lt.${escapePostgrestOrValue(String(value))}`;
    case "lte":
      return `${id}.lte.${escapePostgrestOrValue(String(value))}`;
    case "gt":
      return `${id}.gt.${escapePostgrestOrValue(String(value))}`;
    case "gte":
      return `${id}.gte.${escapePostgrestOrValue(String(value))}`;
    case "isBetween": {
      if (Array.isArray(value) && value.length === 2) {
        const v0 = escapePostgrestOrValue(String(value[0]));
        const v1 = escapePostgrestOrValue(String(value[1]));
        return `and(${id}.gte.${v0},${id}.lte.${v1})`;
      }
      return null;
    }
    case "isEmpty":
      return `${id}.is.null`;
    case "isNotEmpty":
      return `${id}.not.is.null`;
    default:
      return `${id}.eq.${escapePostgrestOrValue(String(value))}`;
  }
}
