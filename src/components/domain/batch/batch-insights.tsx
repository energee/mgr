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
import { CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/universal/status-badge";
import { batchEntity } from "@/entities/batch";
import { dynamicRpc } from "@/services/types";
import { unwrap } from "@/lib/supabase/query-helpers";
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
  RefreshCw,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { batchKeys } from "@/lib/query-keys";

// =============================================================================
// Types
// =============================================================================

type BatchPerformanceResult = {
  batch_id: string;
  batch_code: string;
  status: string;
  recipe: {
    id: string;
    name: string;
    target_og: number | null;
    target_fg: number | null;
    target_abv: number | null;
  };
  actuals: {
    /**
     * SG (1.0xx) since migration 00204 (the SQL converts the Plato knockout
     * measurement); number from current DBs, string tolerated for older
     * cached responses.
     */
    og: number | string | null;
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

type BatchInsightsProps = {
  /** Direct batch ID (for standalone usage) */
  batchId?: string;
  batchNumber?: string;
  /** Entity data prop (for EntityDetail integration) */
  data?: {
    id: string | null;
    batch_code: string | null;
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

  function renderVarianceIcon(): React.ReactNode {
    if (variance == null) return null;
    if (Math.abs(variance) <= 0.002) {
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    }
    if (variance > 0) {
      return <TrendingUp className="h-4 w-4 text-yellow-500" />;
    }
    return <TrendingDown className="h-4 w-4 text-yellow-500" />;
  }

  return (
    <div className="flex items-center justify-between py-2 border-b last:border-b-0">
      <div className="flex items-center gap-2">
        {hasData && renderVarianceIcon()}
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
      <h4 className="font-medium">
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
              {new Date(fermentation.latest_reading.recorded_at).toLocaleDateString("en-US")}
            </span>
          </div>
        )}
        {fermentation.planned_start && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Planned Start</span>
            <span className="text-xs">
              {new Date(fermentation.planned_start).toLocaleDateString("en-US")}
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
  const batchNumber = propBatchNumber || data?.batch_code;

  const [isOpen, setIsOpen] = useState(false);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const supabase = createClient();

  // Fetch batch performance analysis
  // Note: Hook must be called before any early returns (Rules of Hooks)
  const {
    data: performanceData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: batchKeys.performance(batchId!),
    queryFn: async () => {
      if (!batchId) return null;
      return await unwrap(
        dynamicRpc(supabase, "analyze_batch_performance", {
          p_batch_id: batchId,
        })
      ) as unknown as BatchPerformanceResult;
    },
    enabled: hasAnalyzed && !!batchId,
    retry: false,
  });

  // Don't render if no batch ID available
  if (!batchId) {
    return null;
  }

  const handleAnalyze = () => {
    setHasAnalyzed(true);
    setIsOpen(true);
    refetch();
  };

  const performance = performanceData as BatchPerformanceResult | undefined;

  // Count how many metrics (FG, ABV) are within tolerance of their targets
  const totalMetrics = 2;
  const onTargetCount = !performance
    ? 0
    : [
        performance.variances.fg_variance !== null &&
          Math.abs(performance.variances.fg_variance) <= 0.002,
        performance.variances.abv_variance !== null &&
          Math.abs(performance.variances.abv_variance) <= 0.2,
      ].filter(Boolean).length;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-center justify-between pb-3">
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
        </div>
        <div className="flex items-center gap-2">
          {!hasAnalyzed ? (
            <Button size="sm" onClick={handleAnalyze}>
              <BarChart3 className="h-4 w-4 mr-2" />
              Analyze Batch
            </Button>
          ) : (
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={isOpen ? "Collapse insights" : "Expand insights"}>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </Button>
            </CollapsibleTrigger>
          )}
        </div>
      </div>
      {hasAnalyzed && (
        <CardDescription className="pb-3">
          {batchNumber || performance?.batch_code || "Batch"} &bull;{" "}
          {performance?.recipe?.name || "Recipe"}
        </CardDescription>
      )}

      <CollapsibleContent>
        <div className="space-y-6">
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
                <h4 className="font-medium mb-3">
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

              {/* Batch Status */}
              <div className="flex items-center justify-between text-sm pt-2 border-t">
                <span className="text-muted-foreground">Batch Status</span>
                <StatusBadge
                  status={performance.status}
                  config={batchEntity.stateMachine?.stateDisplay}
                />
              </div>
            </>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
