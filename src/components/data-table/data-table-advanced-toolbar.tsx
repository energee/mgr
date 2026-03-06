"use client";

import type * as React from "react";

import { cn } from "@/lib/utils";

interface DataTableAdvancedToolbarProps
  extends React.ComponentProps<"div"> {
  /** Table instance — reserved for future use (e.g., column visibility) */
  table?: unknown;
}

export function DataTableAdvancedToolbar({
  children,
  className,
  ...props
}: DataTableAdvancedToolbarProps) {
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
