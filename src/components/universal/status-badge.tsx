/**
 * Status Badge
 *
 * Universal badge component for displaying entity status.
 * Color is determined by status machine configuration or defaults.
 *
 * Design: Refined, muted colors with warm undertones
 */

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string | null | undefined;
  /** Optional color variant override */
  variant?: "default" | "success" | "warning" | "error" | "info";
  /** Status display config from entity */
  config?: Record<string, { label: string; color: "default" | "success" | "warning" | "error" | "info" }>;
}

const defaultColors: Record<string, "default" | "success" | "warning" | "error" | "info"> = {
  // Common statuses
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

// Refined color classes with warm undertones
const colorClasses: Record<string, string> = {
  default: "bg-secondary text-secondary-foreground border-transparent",
  // Forest green - earthy success
  success: "bg-emerald-50 text-emerald-700 border-emerald-200/50 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/50",
  // Warm amber - attention without alarm
  warning: "bg-amber-50 text-amber-700 border-amber-200/50 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/50",
  // Warm red - soft but clear error
  error: "bg-red-50 text-red-700 border-red-200/50 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800/50",
  // Copper/amber info - the signature accent
  info: "bg-orange-50 text-orange-700 border-orange-200/50 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-800/50",
};

export function StatusBadge({ status, variant, config }: StatusBadgeProps) {
  // Handle null/undefined status
  if (!status) {
    return (
      <Badge variant="outline" className={cn("capitalize font-medium border", colorClasses.default)}>
        —
      </Badge>
    );
  }

  // Get label and color from config or defaults
  const label = config?.[status]?.label || formatStatus(status);
  const color = variant || config?.[status]?.color || defaultColors[status] || "default";

  return (
    <Badge
      variant="outline"
      className={cn(
        "capitalize font-medium border",
        colorClasses[color]
      )}
    >
      {label}
    </Badge>
  );
}

/**
 * Format a snake_case status to Title Case
 */
function formatStatus(status: string): string {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
