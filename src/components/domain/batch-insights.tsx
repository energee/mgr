"use client";

/**
 * BatchInsights - AI-powered batch performance analysis
 *
 * Displays performance metrics comparing batch actuals vs recipe targets.
 * Uses the analyze_batch_performance database function.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  BarChart3,
  Target,
  Activity,
  RefreshCw,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

// =============================================================================
// Types
// =============================================================================

interface BatchPerformanceResult {
  batch_id: string;
  batch_number: string;
  status: string;
  recipe: {
    id: string;
    name: string;
    target_og: number | null;
    target_fg: number | null;
    target_abv: number | null;
  };
  actuals: {
    og: string | null;
    fg: number | null;
    abv: number | null;
  };
  variances: {
    fg_variance: number | null;
    abv_variance: number | null;
  };
  fermentation: {
    planned_start: string | null;
    readings_count: number;
    latest_reading: {
      recorded_at: string;
      measurements: Record<string, unknown>;
    } | null;
  };
}

interface BatchInsightsProps {
  /** Direct batch ID (for standalone usage) */
  batchId?: string;
  batchNumber?: string;
  /** Entity data prop (for EntityDetail integration) */
  data?: {
    id: string | null;
    batch_number: string | null;
    [key: string]: unknown;
  };
}

// =============================================================================
// Helper Components
// =============================================================================

function MetricComparison({
  label,
  target,
  actual,
  variance,
  decimals = 3,
  unit = "",
}: {
  label: string;
  target: number | null;
  actual: number | string | null;
  variance?: number | null;
  decimals?: number;
  unit?: string;
}) {
  const actualNum = typeof actual === "string" ? parseFloat(actual) : actual;
  const hasData = actualNum !== null && !isNaN(actualNum as number);
  const hasTarget = target !== null;

  const getVarianceIcon = () => {
    if (variance === null || variance === undefined) return null;
    if (Math.abs(variance) <= 0.002) {
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    }
    return variance > 0 ? (
      <TrendingUp className="h-4 w-4 text-yellow-500" />
    ) : (
      <TrendingDown className="h-4 w-4 text-yellow-500" />
    );
  };

  return (
    <div className="flex items-center justify-between py-2 border-b last:border-b-0">
      <div className="flex items-center gap-2">
        {hasData && getVarianceIcon()}
        <span className="font-medium">{label}</span>
      </div>
      <div className="text-right">
        <div className="flex items-center gap-2">
          {hasTarget && (
            <span className="text-xs text-muted-foreground">
              Target: {target.toFixed(decimals)}{unit}
            </span>
          )}
          <span className={`font-mono text-sm ${hasData ? "" : "text-muted-foreground"}`}>
            {hasData ? `${(actualNum as number).toFixed(decimals)}${unit}` : "—"}
          </span>
        </div>
        {variance !== null && variance !== undefined && (
          <div className="text-xs text-muted-foreground">
            {variance > 0 ? "+" : ""}{variance.toFixed(decimals)} variance
          </div>
        )}
      </div>
    </div>
  );
}

function FermentationStatus({
  fermentation,
}: {
  fermentation: BatchPerformanceResult["fermentation"];
}) {
  return (
    <div className="space-y-2">
      <h4 className="font-medium flex items-center gap-2">
        <Activity className="h-4 w-4" />
        Fermentation Progress
      </h4>
      <div className="border rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Readings Recorded</span>
          <Badge variant="secondary">{fermentation.readings_count}</Badge>
        </div>
        {fermentation.latest_reading && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Latest Reading</span>
            <span className="text-xs">
              {new Date(fermentation.latest_reading.recorded_at).toLocaleDateString()}
            </span>
          </div>
        )}
        {fermentation.planned_start && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Planned Start</span>
            <span className="text-xs">
              {new Date(fermentation.planned_start).toLocaleDateString()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function BatchInsights({ batchId: propBatchId, batchNumber: propBatchNumber, data }: BatchInsightsProps) {
  // Support both direct props and entity data prop
  const batchId = propBatchId || data?.id;
  const batchNumber = propBatchNumber || data?.batch_number;

  const [isOpen, setIsOpen] = useState(false);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const supabase = createClient();

  // Don't render if no batch ID available
  if (!batchId) {
    return null;
  }

  // Fetch batch performance analysis
  const {
    data: performanceData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["batch-performance", batchId],
    queryFn: async () => {
      // Note: Type assertion needed until supabase types are regenerated
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)("analyze_batch_performance", {
        p_batch_id: batchId,
      });

      if (error) throw error;
      return data as BatchPerformanceResult;
    },
    enabled: hasAnalyzed,
    retry: false,
  });

  const handleAnalyze = () => {
    setHasAnalyzed(true);
    setIsOpen(true);
    refetch();
  };

  const performance = performanceData as BatchPerformanceResult | undefined;

  // Calculate how many metrics are on target
  const getOnTargetCount = () => {
    if (!performance) return 0;
    let count = 0;
    const { variances } = performance;

    if (variances.fg_variance !== null && Math.abs(variances.fg_variance) <= 0.002) {
      count++;
    }
    if (variances.abv_variance !== null && Math.abs(variances.abv_variance) <= 0.2) {
      count++;
    }
    return count;
  };

  const onTargetCount = getOnTargetCount();
  const totalMetrics = 2; // FG and ABV

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Batch Insights</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {hasAnalyzed && !isLoading && performance && (
                <Badge
                  variant={onTargetCount === totalMetrics ? "default" : "secondary"}
                  className="gap-1"
                >
                  <Target className="h-3 w-3" />
                  {onTargetCount}/{totalMetrics} on target
                </Badge>
              )}
              {!hasAnalyzed ? (
                <Button size="sm" onClick={handleAnalyze}>
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Analyze Batch
                </Button>
              ) : (
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    />
                  </Button>
                </CollapsibleTrigger>
              )}
            </div>
          </div>
          {hasAnalyzed && (
            <CardDescription>
              {batchNumber || performance?.batch_number || "Batch"} &bull;{" "}
              {performance?.recipe?.name || "Recipe"}
            </CardDescription>
          )}
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-6">
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <AlertTriangle className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-muted-foreground">
                  Unable to analyze batch. Make sure the batch has associated readings and brew log data.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => refetch()}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Try Again
                </Button>
              </div>
            ) : performance ? (
              <>
                {/* Performance Metrics */}
                <div>
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    Actuals vs Targets
                  </h4>
                  <div className="border rounded-lg p-3">
                    <MetricComparison
                      label="OG"
                      target={performance.recipe.target_og}
                      actual={performance.actuals.og}
                      decimals={3}
                    />
                    <MetricComparison
                      label="FG"
                      target={performance.recipe.target_fg}
                      actual={performance.actuals.fg}
                      variance={performance.variances.fg_variance}
                      decimals={3}
                    />
                    <MetricComparison
                      label="ABV"
                      target={performance.recipe.target_abv}
                      actual={performance.actuals.abv}
                      variance={performance.variances.abv_variance}
                      decimals={1}
                      unit="%"
                    />
                  </div>
                </div>

                {/* Fermentation Status */}
                <FermentationStatus fermentation={performance.fermentation} />

                {/* Status */}
                <div className="flex items-center justify-between text-sm pt-2 border-t">
                  <span className="text-muted-foreground">Batch Status</span>
                  <Badge variant="outline" className="capitalize">
                    {performance.status}
                  </Badge>
                </div>
              </>
            ) : null}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
