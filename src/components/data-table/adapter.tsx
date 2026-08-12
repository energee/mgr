/**
 * Data Table Adapter
 *
 * Translates EntityConfig definitions → Dice UI DataTable columns with meta.
 * Pure translation layer — no entity config changes needed.
 */

/** Column IDs reserved for non-navigable columns (checkboxes, action menus). */
export const NON_NAVIGABLE_COLUMN_IDS = ["select", "actions"] as const;

/** Prefix for resolved FK relation display values stored on row data by entity-data-table queryFn. */
export const REL_KEY_PREFIX = "__rel_";

import type { ColumnDef } from "@tanstack/react-table";
import type {
  EntityConfig,
  EntityActionDef,
  EntityColumnDef,
  EntityFilterDef,
} from "@/types/entity";
import type { FilterVariant, Option, ExtendedColumnFilter } from "@/types/data-table";
import type { DynamicQueryBuilder } from "@/services/types";
import { formatValue } from "@/lib/format";
import { escapeIlikePattern } from "@/lib/supabase/query-helpers";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { MoreHorizontal } from "lucide-react";
import { ActionMenuItem } from "@/components/universal/action-menu-item";
import { getApplicableActions } from "@/lib/entity-actions";
import { UnitDisplay } from "@/components/ui/unit-input";
import { memo } from "react";

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
// CellRenderer (memoized)
// =============================================================================

/**
 * Stable cell renderer component.
 * Wrapped in React.memo to prevent re-renders when column defs regenerate
 * but the actual cell data hasn't changed.
 */
const CellRenderer = memo(function CellRenderer<T>({
  value,
  original,
  col,
}: {
  value: unknown;
  original: T;
  col: EntityColumnDef<T>;
}) {
  if (col.render) {
    return col.render(value, original);
  }

  // Resolve FK relation columns via pre-fetched lookup (see entity-data-table queryFn)
  if (col.relation) {
    const accessorKey = col.accessorKey as string | undefined;
    if (accessorKey) {
      const resolved = (original as Record<string, unknown>)[`${REL_KEY_PREFIX}${accessorKey}`];
      if (resolved != null) return String(resolved);
    }
    return value ? "—" : null;
  }

  if (col.format === "unit" && col.unitType) {
    return <UnitDisplay value={value as number | null} unitType={col.unitType} />;
  }

  return formatValue(value, col.format);
}) as <T>(props: {
  value: unknown;
  original: T;
  col: EntityColumnDef<T>;
}) => React.ReactElement | string | null;

// =============================================================================
// buildDataTableColumns
// =============================================================================

/**
 * Maps EntityColumnDef[] + EntityFilterDef[] → Dice UI ColumnDef[] with meta.
 * Joins filters onto matching columns by field name. Filters that don't match
 * any visible column get appended as hidden filter-only columns so the filter
 * UI can still discover and render them (e.g. filtering on `brand_id` when the
 * display column is `brand_name`).
 */
export function buildDataTableColumns<T>(
  entity: EntityConfig<T>,
  dynamicFilterOptions: Record<string, { value: string; label: string }[]>
): ColumnDef<T>[] {
  const filtersByField = new Map<string, EntityFilterDef>();
  entity.listFilters?.forEach((f) => filtersByField.set(f.field, f));

  const matchedFilterFields = new Set<string>();

  const visibleColumns = entity.listColumns.map((col: EntityColumnDef<T>) => {
    const accessorKey = col.accessorKey as string | undefined;
    const filter = accessorKey ? filtersByField.get(accessorKey) : undefined;

    if (filter) matchedFilterFields.add(filter.field);

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
        return <CellRenderer value={value} original={row.original} col={col} />;
      },
    } as ColumnDef<T>;
  });

  // Append hidden filter-only columns for filters that don't match any visible column.
  const hiddenFilterColumns: ColumnDef<T>[] = [];
  for (const filter of entity.listFilters ?? []) {
    if (matchedFilterFields.has(filter.field)) continue;

    const rawOptions =
      dynamicFilterOptions[filter.field] || filter.options || [];
    const options = rawOptions.map((opt) => ({
      label: opt.label,
      value: opt.value,
    }));

    hiddenFilterColumns.push({
      id: filter.field,
      accessorKey: filter.field as keyof T & string,
      header: filter.label,
      enableSorting: false,
      enableHiding: false,
      enableColumnFilter: true,
      meta: {
        label: filter.label,
        variant: toFilterVariant(filter.type),
        ...(options.length > 0 ? { options } : {}),
      },
      cell: () => null,
    } as ColumnDef<T>);
  }

  return [...visibleColumns, ...hiddenFilterColumns];
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
 * Creates the row actions dropdown column (View, state transitions, custom actions).
 *
 * Actions with `confirm: true` are routed through `onConfirmRequired` instead
 * of dispatching directly — the caller (entity-data-table) owns the shared
 * EntityActionConfirmDialog and re-dispatches on confirm, mirroring the
 * onDelete/setDeleteTarget plumbing.
 */
export function buildActionsColumn<T>(
  entity: EntityConfig<T>,
  basePath: string,
  onAction?: (actionName: string, record: T) => boolean,
  onTransition?: (id: string, toState: string) => void,
  onDelete?: (record: T, action: EntityActionDef<T>) => void,
  onConfirmRequired?: (record: T, action: EntityActionDef<T>) => void
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
            {/* Icon-only trigger needs an explicit name — otherwise every
                entity table announces a bare "button" (audit A11Y-2). */}
            <Button variant="ghost" size="sm" aria-label="Row actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <ActionMenuItem icon="view" label="View" href={`${basePath}/${id}`} />
            {/* showWhen/fromStates visibility shared with the mobile card menu */}
            {getApplicableActions(entity, record).map((action) => {
              const disabledReason = action.disabledWhen?.(record);
              return (
                <ActionMenuItem
                  key={action.name}
                  icon={action.icon}
                  label={action.label}
                  variant={action.variant === "destructive" ? "destructive" : undefined}
                  disabled={!!disabledReason}
                  title={disabledReason || undefined}
                  onClick={() => {
                    if (disabledReason) return;
                    if (action.name === "delete" && action.deleteMode && onDelete) {
                      onDelete(record, action);
                      return;
                    }
                    // Confirm gate runs BEFORE the onAction override so
                    // page-intercepted actions are covered too.
                    if (action.confirm && onConfirmRequired) {
                      onConfirmRequired(record, action);
                      return;
                    }
                    if (onAction && onAction(action.name, record)) {
                      return;
                    }
                    if (action.toState && onTransition) {
                      onTransition(id, action.toState);
                      return;
                    }
                    action.handler?.(record);
                  }}
                />
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
  return (query: DynamicQueryBuilder) => {
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
function applyFilterToQuery<T>(query: DynamicQueryBuilder, filter: ExtendedColumnFilter<T>) {
  const { id, value, operator } = filter;
  if (value === undefined || value === null || value === "") {
    if (operator !== "isEmpty" && operator !== "isNotEmpty") return query;
  }

  switch (operator) {
    case "iLike":
      return query.ilike(id, `%${escapeIlikePattern(String(value))}%`);
    case "notILike":
      return query.not(id, "ilike", `%${escapeIlikePattern(String(value))}%`);
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
function buildPostgrestCondition<T>(filter: ExtendedColumnFilter<T>): string | null {
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
      // Wrap in nested and() to avoid tautology when inside an or() context
      const conditions = arr.map((v) => `${id}.neq.${escapePostgrestOrValue(String(v))}`).join(",");
      return arr.length > 1 ? `and(${conditions})` : conditions;
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
