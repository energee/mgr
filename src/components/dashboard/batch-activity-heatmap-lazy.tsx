"use client";

/**
 * Lazy-loaded BatchActivityHeatmap
 *
 * Dynamically imports the react-activity-calendar-heavy heatmap so the
 * dashboard doesn't pull it into its initial bundle (same pattern as
 * trend-chart-lazy.tsx). Its `tooltips.css` is imported from the dashboard
 * layout so tooltip styles ship with the route CSS instead of arriving with
 * this deferred chunk (audit F-142).
 */

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// Lazy load the heatmap component - only loads when component is rendered.
// 200px matches the TrendChartLazy fallback rendered beside it in the same
// dashboard grid row and the heatmap's own data-loading skeleton, so the
// chunk-load -> data-load handoff doesn't shift layout.
export const BatchActivityHeatmapLazy = dynamic(
  () =>
    import("./batch-activity-heatmap").then((mod) => mod.BatchActivityHeatmap),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[200px] w-full" />,
  },
);
