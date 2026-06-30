"use client";

/**
 * Lazy-loaded TrendChart
 *
 * Dynamically imports the recharts-heavy TrendChart component so dashboards
 * don't pull recharts into their initial bundle (same pattern as
 * batch-readings-chart-lazy.tsx).
 */

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// Lazy load the chart component - only loads when component is rendered
export const TrendChartLazy = dynamic(
  () => import("./trend-chart").then((mod) => mod.TrendChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[200px] w-full" />,
  },
);
