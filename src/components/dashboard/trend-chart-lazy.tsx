"use client";

/**
 * Lazy-loaded TrendChart
 *
 * Dynamically imports the recharts-heavy TrendChart component so dashboards
 * don't pull recharts into their initial bundle. Uses React.lazy + an
 * explicit <Suspense> at the call site rather than next/dynamic(ssr:false) —
 * nesting a dynamic(ssr:false) boundary inside another Suspense that itself
 * suspends (usePeriod()'s useSearchParams) caused a hydration mismatch on
 * /dashboard (MGR-6 / SENTRY-7477285440), same class of bug already fixed for
 * ChatLayout's ChatPanel.
 */

import { lazy } from "react";

export const TrendChartLazy = lazy(() =>
  import("./trend-chart").then((mod) => ({ default: mod.TrendChart }))
);
