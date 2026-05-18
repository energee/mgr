import type { ColumnSort, Row, RowData } from "@tanstack/react-table";
import type { DataTableConfig } from "@/lib/data-table-config";
import type { FilterItemSchema } from "@/lib/parsers";

/* eslint-disable @typescript-eslint/no-unused-vars -- TData/TValue required for module augmentation but not used in interface body */
declare module "@tanstack/react-table" {
  interface TableMeta<TData extends RowData> {
    queryKeys?: QueryKeys;
  }

  interface ColumnMeta<TData extends RowData, TValue> {
    label?: string;
    placeholder?: string;
    variant?: FilterVariant;
    options?: Option[];
    range?: [number, number];
    unit?: string;
    icon?: React.FC<React.SVGProps<SVGSVGElement>>;
  }
}
/* eslint-enable @typescript-eslint/no-unused-vars */

export type QueryKeys = {
  page: string;
  perPage: string;
  sort: string;
  filters: string;
  joinOperator: string;
}

export type Option = {
  label: string;
  value: string;
  count?: number;
  icon?: React.FC<React.SVGProps<SVGSVGElement>>;
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
