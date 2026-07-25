import type { ColumnSort, Row, RowData } from "@tanstack/react-table";
import type { DataTableConfig } from "@/lib/data-table-config";
import type { FilterItemSchema } from "@/lib/parsers";

/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/consistent-type-definitions -- TData/TValue required for module augmentation but not used in interface body; `interface` required for declaration merging inside `declare module` (AGENTS.md constraint 3 exception) */
declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    label?: string;
    variant?: FilterVariant;
    options?: Option[];
  }
}
/* eslint-enable @typescript-eslint/no-unused-vars */

export type Option = {
  label: string;
  value: string;
}

export type FilterOperator = DataTableConfig["operators"][number];
export type FilterVariant = DataTableConfig["filterVariants"][number];
export type JoinOperator = DataTableConfig["joinOperators"][number];

export type ExtendedColumnSort<TData> = Omit<ColumnSort, "id"> & {
  id: Extract<keyof TData, string>;
}

export type ExtendedColumnFilter<TData> = FilterItemSchema & {
  id: Extract<keyof TData, string>;
}

export type DataTableRowAction<TData> = {
  row: Row<TData>;
  variant: "update" | "delete";
}
