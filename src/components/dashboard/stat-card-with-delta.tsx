/**
 * Stat Card with Delta
 *
 * Displays a metric value with period-over-period comparison.
 * Shows a current value, label, and delta percentage vs previous period.
 */

import Link from "next/link";
import { cn } from "@/lib/utils";

type StatCardWithDeltaProps = {
  /** The primary value to display */
  value: string | number;
  /** Label below the value */
  label: string;
  /** Percentage change vs previous period (e.g., 12 for +12%, -5 for -5%) */
  delta?: number | null;
  /** Text shown after the delta (e.g., "vs last 7d") */
  deltaLabel?: string;
  /** Optional link wrapping the card */
  href?: string;
  /** Additional className */
  className?: string;
}

/**
 * Formats a number as a display value (e.g., 1234 -> "1,234").
 */
function formatDisplayValue(value: string | number): string {
  if (typeof value === "string") return value;
  return value.toLocaleString();
}

/**
 * Formats a delta as a signed percentage string.
 */
function formatDelta(delta: number): string {
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${Math.round(delta)}%`;
}

export function StatCardWithDelta({
  value,
  label,
  delta,
  deltaLabel,
  href,
  className,
}: StatCardWithDeltaProps) {
  const content = (
    <div
      className={cn(
        "rounded-lg border bg-card p-4 space-y-1",
        href && "hover:bg-muted/50 transition-colors",
        className
      )}
    >
      <div className="font-mono text-2xl font-semibold">
        {formatDisplayValue(value)}
      </div>
      <div className="text-sm text-muted-foreground">{label}</div>
      {delta != null && (
        <div
          className={cn(
            "text-xs font-medium font-mono",
            delta > 0 && "text-emerald-600 dark:text-emerald-400",
            delta < 0 && "text-amber-600 dark:text-amber-400",
            delta === 0 && "text-muted-foreground"
          )}
        >
          {formatDelta(delta)}
          {deltaLabel && (
            <span className="text-muted-foreground font-sans font-normal ml-1">
              {deltaLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }

  return content;
}

/**
 * Calculates the percentage change between two values.
 * Returns 100 if previous is 0 and current > 0 (new activity).
 * Returns null if both values are 0 (no meaningful delta).
 */
export function calculateDelta(
  current: number,
  previous: number
): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}
