"use client";

/**
 * Lazy-loaded BatchReadingsChart
 *
 * Dynamically imports the recharts-heavy BatchReadingsChart component
 * to reduce initial bundle size (~350KB savings).
 */

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Lazy load the chart component - only loads when component is rendered
export const BatchReadingsChartLazy = dynamic(
  () => import("./batch-readings-chart").then((mod) => mod.BatchReadingsChart),
  {
    ssr: false,
    loading: () => (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Fermentation Chart</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[250px] flex items-center justify-center">
            <Skeleton className="h-full w-full" />
          </div>
        </CardContent>
      </Card>
    ),
  }
);
