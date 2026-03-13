/**
 * Dashboard Section
 *
 * Refined card wrapper for dashboard content sections.
 * Features uppercase tracking headers and optional "View All" links.
 */

import Link from "next/link";
import { Inbox, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type DashboardSectionProps = {
  /** Section title (displayed uppercase with tracking) */
  title: string;
  /** Optional link to full list view */
  viewAllHref?: string;
  /** Custom label for the view all link */
  viewAllLabel?: string;
  /** Section content */
  children: React.ReactNode;
  /** Additional className for the container */
  className?: string;
}

export function DashboardSection({
  title,
  viewAllHref,
  viewAllLabel = "View All",
  children,
  className,
}: DashboardSectionProps) {
  return (
    <div className={cn("rounded-lg border bg-card p-4", className)}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {viewAllLabel}
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * Empty state for dashboard sections.
 * Renders an optional icon above a centered message.
 */
export function DashboardEmpty({
  message,
  icon: Icon = Inbox,
}: {
  message: string;
  /** Lucide icon component to display above the message (defaults to Inbox) */
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-6">
      <Icon className="size-8 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground text-center">{message}</p>
    </div>
  );
}
