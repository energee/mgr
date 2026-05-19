/**
 * RecipeSectionCard - Reusable section card wrapper for recipe editor.
 *
 * Provides a consistent card layout with title, optional subtitle,
 * collapsible toggle, optional header actions slot, and an unsaved
 * changes indicator (amber dot next to title when isDirty is true).
 */

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type RecipeSectionCardProps = {
  title: string;
  subtitle?: string;
  /** Slot for action buttons rendered in the card header */
  headerActions?: ReactNode;
  /** Whether the section has unsaved changes (shows visual indicator) */
  isDirty?: boolean;
  /** Whether the section can be collapsed (default: false) */
  collapsible?: boolean;
  /** Whether the section starts collapsed (default: false) */
  defaultCollapsed?: boolean;
  children: ReactNode;
  className?: string;
};

export function RecipeSectionCard({
  title,
  subtitle,
  headerActions,
  isDirty = false,
  collapsible = false,
  defaultCollapsed = false,
  children,
  className,
}: RecipeSectionCardProps) {
  const sectionId = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const contentId = `section-content-${sectionId}`;
  const storageKey = `recipe-section-${sectionId}`;

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return defaultCollapsed;
    const stored = sessionStorage.getItem(storageKey);
    return stored !== null ? stored === "true" : defaultCollapsed;
  });

  useEffect(() => {
    sessionStorage.setItem(storageKey, String(collapsed));
  }, [storageKey, collapsed]);

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
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-semibold">{title}</h3>
            {isDirty && (
              <span
                className="h-2 w-2 rounded-full bg-amber-500 shrink-0"
                title="Unsaved changes"
                aria-label="Unsaved changes"
              />
            )}
          </div>
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
            aria-expanded={!collapsed}
            aria-controls={contentId}
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
      {!collapsed && <div id={contentId} className="p-4">{children}</div>}
    </div>
  );
}
