/**
 * Status Badge
 *
 * Universal badge component for displaying entity status.
 * Color is determined by status machine configuration or defaults.
 */

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
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

const colorClasses: Record<string, string> = {
  default: "bg-secondary text-secondary-foreground",
  success: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  warning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  info: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
};

export function StatusBadge({ status, variant, config }: StatusBadgeProps) {
  // Get label and color from config or defaults
  const label = config?.[status]?.label || formatStatus(status);
  const color = variant || config?.[status]?.color || defaultColors[status] || "default";

  return (
    <Badge variant="outline" className={cn("capitalize", colorClasses[color])}>
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
