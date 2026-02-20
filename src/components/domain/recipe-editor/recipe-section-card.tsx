/**
 * RecipeSectionCard - Reusable section card wrapper for recipe editor.
 *
 * Provides a consistent card layout with title, optional subtitle,
 * collapsible toggle, and optional header actions slot.
 */

"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface RecipeSectionCardProps {
  title: string;
  subtitle?: string;
  /** Slot for action buttons rendered in the card header */
  headerActions?: ReactNode;
  /** Whether the section can be collapsed (default: false) */
  collapsible?: boolean;
  /** Whether the section starts collapsed (default: false) */
  defaultCollapsed?: boolean;
  children: ReactNode;
  className?: string;
}

export function RecipeSectionCard({
  title,
  subtitle,
  headerActions,
  collapsible = false,
  defaultCollapsed = false,
  children,
  className,
}: RecipeSectionCardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const headerContent = (
    <>
      <div className="flex items-center gap-2">
        {collapsible && (
          <span className="text-muted-foreground">
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </span>
        )}
        <div className="text-left">
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
      {/* Spacer to push actions to the right */}
      <div className="flex-1" />
    </>
  );

  return (
    <div
      className={cn(
        "rounded-lg border bg-card text-card-foreground shadow-sm",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between px-4 py-3",
          !collapsed && "border-b"
        )}
      >
        {collapsible ? (
          <button
            type="button"
            className="flex items-center gap-2 flex-1 cursor-pointer select-none"
            onClick={() => setCollapsed((c) => !c)}
          >
            {headerContent}
          </button>
        ) : (
          <div className="flex items-center gap-2 flex-1">
            {headerContent}
          </div>
        )}
        {headerActions && (
          <div className="flex items-center gap-2 ml-2">
            {headerActions}
          </div>
        )}
      </div>
      {!collapsed && <div className="p-4">{children}</div>}
    </div>
  );
}
