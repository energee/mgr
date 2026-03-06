/**
 * Status Badge
 *
 * Universal badge for displaying entity status.
 * Linear-inspired: small colored dot + text label, minimal chrome.
 */

import { cn } from "@/lib/utils";

type StatusColor = "default" | "success" | "warning" | "error" | "info";

interface StatusBadgeProps {
  status: string | null | undefined;
  variant?: StatusColor;
  config?: Record<string, { label: string; color: StatusColor }>;
  /** Use compact dot-only display (no text) */
  dotOnly?: boolean;
}

const defaultColors: Record<string, StatusColor> = {
  draft: "default",
  planned: "default",
  active: "info",
  in_progress: "info",
  fermenting: "info",
  conditioning: "info",
  completed: "success",
  packaged: "success",
  fulfilled: "success",
  out_the_door: "success",
  confirmed: "info",
  scheduled: "info",
  picking: "info",
  packed: "success",
  cancelled: "error",
  warning: "warning",
  error: "error",
};

const dotColors: Record<StatusColor, string> = {
  default: "bg-muted-foreground",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
  info: "bg-primary",
};

export function StatusBadge({ status, variant, config, dotOnly }: StatusBadgeProps) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className={cn("size-1.5 rounded-full shrink-0", dotColors.default)} />
        {!dotOnly && <span>&mdash;</span>}
      </span>
    );
  }

  const label = config?.[status]?.label || formatStatus(status);
  const color = variant || config?.[status]?.color || defaultColors[status] || "default";

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span className={cn("size-1.5 rounded-full shrink-0", dotColors[color])} />
      {!dotOnly && <span>{label}</span>}
    </span>
  );
}

function formatStatus(status: string): string {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
