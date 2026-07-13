"use client";

/**
 * Lazy-loaded BatchActivityHeatmap
 *
 * Dynamically imports the react-activity-calendar-heavy heatmap so the
 * dashboard doesn't pull it into its initial bundle. Its `tooltips.css` is
 * imported from the dashboard layout so tooltip styles ship with the route
 * CSS instead of arriving with this deferred chunk (audit F-142).
 *
 * Uses React.lazy + an explicit <Suspense> at the call site rather than
 * next/dynamic(ssr:false) — nesting a dynamic(ssr:false) boundary inside
 * another Suspense that itself suspends (usePeriod()'s useSearchParams)
 * caused a hydration mismatch on /dashboard (MGR-6 / SENTRY-7477285440), same
 * class of bug already fixed for ChatLayout's ChatPanel.
 */

import { lazy } from "react";

export const BatchActivityHeatmapLazy = lazy(() =>
  import("./batch-activity-heatmap").then((mod) => ({ default: mod.BatchActivityHeatmap }))
);
