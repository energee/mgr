"use client";

/**
 * Lazy-loaded CogsPeriodChart
 *
 * Dynamically imports the recharts-heavy CogsPeriodChart so the COGS report
 * page only loads recharts when the By Period tab actually renders the chart
 * (same pattern as batch-readings-chart-lazy.tsx).
 */

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// Lazy load the chart component - only loads when component is rendered
export const CogsPeriodChartLazy = dynamic(
  () => import("./cogs-period-chart").then((mod) => mod.CogsPeriodChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[400px] w-full" />,
  },
);
