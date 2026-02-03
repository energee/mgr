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

export function StatsStrip({ stats, secondaryStats, className }: StatsStripProps) {
  return (
    <div className={cn("flex items-baseline gap-6 py-3 border-b text-sm", className)}>
      {stats.map((stat, index) => (
        <div key={stat.label} className="contents">
          {index > 0 && <span className="text-border">|</span>}
          <StatDisplay stat={stat} />
        </div>
      ))}

      {secondaryStats && secondaryStats.length > 0 && (
        <div className="ml-auto flex items-baseline gap-4 text-muted-foreground">
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
