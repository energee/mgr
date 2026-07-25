import type { Column } from "@tanstack/react-table";
import { dataTableConfig } from "@/lib/data-table-config";
import type {
  FilterOperator,
  FilterVariant,
} from "@/types/data-table";

/**
 * Inline style for a table header/cell.
 *
 * Column pinning is never enabled on any table, so this is just the sizing and
 * stacking context TanStack expects: `width` from the column's measured size,
 * plus an opaque background so sticky rows don't bleed through.
 */
export function getColumnStyle<TData>({
  column,
}: {
  column: Column<TData>;
}): React.CSSProperties {
  return {
    position: "relative",
    background: "var(--background)",
    width: column.getSize(),
  };
}

export function getFilterOperators(filterVariant: FilterVariant) {
  const operatorMap: Record<
    FilterVariant,
    { label: string; value: FilterOperator }[]
  > = {
    text: dataTableConfig.textOperators,
    date: dataTableConfig.dateOperators,
    dateRange: dataTableConfig.dateOperators,
    boolean: dataTableConfig.booleanOperators,
    select: dataTableConfig.selectOperators,
    multiSelect: dataTableConfig.multiSelectOperators,
  };

  return operatorMap[filterVariant] ?? dataTableConfig.textOperators;
}

export function getDefaultFilterOperator(filterVariant: FilterVariant) {
  const operators = getFilterOperators(filterVariant);

  return operators[0]?.value ?? (filterVariant === "text" ? "iLike" : "eq");
}
