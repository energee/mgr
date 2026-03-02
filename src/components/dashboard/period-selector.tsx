"use client";

/**
 * Period Selector
 *
 * Segmented toggle for selecting a date range (7d / 30d / 90d).
 * Uses URL search params so dashboard views are shareable.
 */

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { cn } from "@/lib/utils";

const PERIODS = [
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
] as const;

const DEFAULT_PERIOD = 30;

interface PeriodSelectorProps {
  /** Additional className for the container */
  className?: string;
}

/**
 * Hook to read the current period from URL search params.
 * Returns the number of days (7, 30, or 90). Defaults to 30.
 */
export function usePeriod(): number {
  const searchParams = useSearchParams();
  const raw = searchParams.get("period");
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (parsed === 7 || parsed === 30 || parsed === 90) return parsed;
  return DEFAULT_PERIOD;
}

export function PeriodSelector({ className }: PeriodSelectorProps) {
  const period = usePeriod();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setPeriod = useCallback(
    (days: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (days === DEFAULT_PERIOD) {
        params.delete("period");
      } else {
        params.set("period", String(days));
      }
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border bg-muted p-0.5 text-xs",
        className
      )}
      role="radiogroup"
      aria-label="Time period"
    >
      {PERIODS.map(({ days, label }) => (
        <button
          key={days}
          role="radio"
          aria-checked={period === days}
          onClick={() => setPeriod(days)}
          className={cn(
            "px-2.5 py-1 rounded-sm font-mono font-medium transition-colors",
            period === days
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
