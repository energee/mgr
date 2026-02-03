/**
 * Stats Strip
 *
 * Inline statistics display for dashboard headers.
 * Dense, utilitarian design with monospaced numbers.
 */

import Link from "next/link";
import { cn } from "@/lib/utils";

export interface StatItem {
  /** The numeric or string value to display */
  value: number | string;
  /** Label shown after the value */
  label: string;
  /** Optional link for the stat */
  href?: string;
  /** Visual variant for emphasis */
  variant?: "default" | "warning";
}

interface StatsStripProps {
  /** Primary stats shown on the left */
  stats: StatItem[];
  /** Secondary stats pushed to the right */
  secondaryStats?: StatItem[];
  /** Custom content pushed to the right (e.g., filters) - takes precedence over secondaryStats */
  children?: React.ReactNode;
  /** Additional className for the container */
  className?: string;
}

function StatDisplay({ stat }: { stat: StatItem }) {
  const isWarning = stat.variant === "warning";

  const content = (
    <div className="flex items-baseline gap-1.5">
      <span
        className={cn(
          "font-mono text-2xl font-semibold",
          isWarning && "text-amber-600"
        )}
      >
        {stat.value}
      </span>
      <span className={cn("text-muted-foreground", isWarning && "text-amber-600")}>
        {stat.label}
      </span>
    </div>
  );

  if (stat.href) {
    return (
      <Link href={stat.href} className="hover:underline">
        {content}
      </Link>
    );
  }

  return content;
}

export function StatsStrip({ stats, secondaryStats, children, className }: StatsStripProps) {
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-8 gap-y-3 py-3 text-sm", className)}>
      {stats.map((stat) => (
        <StatDisplay key={stat.label} stat={stat} />
      ))}

      {children && (
        <div className="sm:ml-auto flex items-center gap-3">{children}</div>
      )}

      {!children && secondaryStats && secondaryStats.length > 0 && (
        <div className="sm:ml-auto flex flex-wrap items-baseline gap-x-6 gap-y-2 text-muted-foreground">
          {secondaryStats.map((stat) => (
            <span key={stat.label}>
              <span className="font-mono font-medium">{stat.value}</span> {stat.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
