"use client";

import type { Table } from "@tanstack/react-table";
import type * as React from "react";

import { cn } from "@/lib/utils";

interface DataTableAdvancedToolbarProps<TData>
  extends React.ComponentProps<"div"> {
  table: Table<TData>;
}

export function DataTableAdvancedToolbar<TData>({
  table: _table,
  children,
  className,
  ...props
}: DataTableAdvancedToolbarProps<TData>) {
  return (
    <div
      role="toolbar"
      aria-orientation="horizontal"
      className={cn(
        "flex w-full items-center gap-2",
        className,
      )}
      {...props}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
