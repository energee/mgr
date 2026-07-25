"use client";

import type * as React from "react";

import { cn } from "@/lib/utils";

type DataTableAdvancedToolbarProps = React.ComponentProps<"div">;

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
