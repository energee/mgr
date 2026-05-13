"use client";

/**
 * Production Dashboard
 *
 * Overview of production metrics:
 * - Batch status summary
 * - Active batches list
 * - Vessel utilization
 * - Period-over-period trend comparison (delta cards)
 * - Trend charts for batches started and volume brewed
 */

import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { dashboardKeys, onboardingKeys, planningKeys } from "@/lib/query-keys";
import type { ProductionShortfall } from "@/types/planning";
import Link from "next/link";
import { CACHE_DURATIONS, POLLING_INTERVALS } from "@/lib/constants";
import { dynamicFrom, dynamicRpc } from "@/services/types";
import { VESSEL_TYPES } from "@/entities/vessel";
import { batchEntity } from "@/entities/batch";
import { StatusBadge } from "@/components/universal/status-badge";
import { CheckCircle2, Circle, FlaskConical } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Suspense, useMemo } from "react";
import {
  StatsStrip,
  DashboardSection,
  DashboardEmpty,
  PeriodSelector,
  usePeriod,
  StatCardWithDelta,
  calculateDelta,
  TrendChart,
  BatchActivityHeatmap,
} from "@/components/dashboard";
import type { StatItem } from "@/components/dashboard";
import { bucketWeekly } from "@/components/dashboard/heatmap-utils";
import { useVolumeUnit } from "@/hooks/useUnitPreferences";
import { convertVolume, UNIT_LABELS } from "@/lib/units";
import { log } from "@/lib/client-logger";

// =============================================================================
// Types
// =============================================================================

type BatchStatusCounts = {
  planned: number;
  fermenting: number;
  conditioning: number;
  packaging: number;
  completed: number;
}

type ActiveBatch = {
  id: string;
  batch_code: string;
  name: string;
  status: string;
  volume_bbl: number | null;
  planned_start_date: string | null;
  recipe_name?: string;
}

type VesselStatus = {
  id: string;
  name: string;
  vessel_type: string;
  status: string;
  current_batch_name?: string;
  capacity_bbl: number | null;
}

// =============================================================================
// Constants
// =============================================================================

const MAX_BATCHES_SHOWN = 8;

const DEFAULT_BATCH_COUNTS: BatchStatusCounts = {
  planned: 0,
  fermenting: 0,
  conditioning: 0,
  packaging: 0,
  completed: 0,
};

// =============================================================================
// Getting Started Checklist
// =============================================================================

/** Onboarding checklist shown when the brewery has minimal data. Hides once all steps are complete. */
function GettingStartedChecklist() {
  const supabase = createClient();

  const { data: counts, isLoading } = useQuery({
    queryKey: onboardingKeys.counts(),
    queryFn: async () => {
      const [locations, recipes, batches] = await Promise.all([
        supabase.from("locations").select("*", { count: "exact", head: true }),
        supabase.from("recipes").select("*", { count: "exact", head: true }),
        supabase.from("batches").select("*", { count: "exact", head: true }),
      ]);
      return {
        locations: locations.count ?? 0,
        recipes: recipes.count ?? 0,
        batches: batches.count ?? 0,
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading || !counts) return null;

  const steps = [
    { label: "Add your first location", href: "/settings/locations/new", done: counts.locations > 0 },
    { label: "Create a recipe", href: "/production/recipes/new", done: counts.recipes > 0 },
    { label: "Start your first batch", href: "/production/batches/new", done: counts.batches > 0 },
  ];

  const completedCount = steps.filter((s) => s.done).length;

  // Hide when all steps are complete
  if (completedCount === steps.length) return null;

  return (
    <DashboardSection title="Getting Started">
      <div className="divide-y">
        {steps.map((step) => (
          <Link
            key={step.href}
            href={step.href}
            className="flex items-center gap-3 py-2"
          >
            {step.done ? (
              <CheckCircle2 className="size-5 text-emerald-500 shrink-0" />
            ) : (
              <Circle className="size-5 text-muted-foreground/40 shrink-0" />
            )}
            <span
              className={`text-sm ${step.done ? "line-through text-muted-foreground" : ""}`}
            >
              {step.label}
            </span>
          </Link>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        {completedCount} of {steps.length} complete
      </p>
    </DashboardSection>
  );
}

// =============================================================================
// Component
// =============================================================================

export default function DashboardPage() {
  const supabase = createClient();
  const volumeUnit = useVolumeUnit();
  const volumeLabel = UNIT_LABELS[volumeUnit];

  const { data: batchCounts = DEFAULT_BATCH_COUNTS } = useQuery({
    queryKey: dashboardKeys.batchCounts(),
    queryFn: async () => {
      const { data, error } = await dynamicFrom(supabase, "batch_status_counts")
        .select("status, count");

      if (error) throw error;

      const counts = { ...DEFAULT_BATCH_COUNTS };
      for (const row of data ?? []) {
        const status = row.status as keyof BatchStatusCounts;
        if (status in counts) {
          counts[status] = row.count;
        }
      }
      return counts;
    },
    refetchInterval: POLLING_INTERVALS.FAST,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
  });

  // Fetch active batches (not completed or cancelled)
  const { data: activeBatches = [] } = useQuery({
    queryKey: dashboardKeys.activeBatches(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("batches")
        .select(`
          id,
          batch_code,
          name,
          status,
          volume_bbl,
          planned_start_date,
          recipes:recipe_id(name)
        `)
        .not("status", "in", '("completed","cancelled")')
        .order("planned_start_date", { ascending: true })
        .limit(10);

      if (error) throw error;

      return (data || []).map((batch) => ({
        ...batch,
        recipe_name: (batch.recipes as { name: string } | null)?.name,
      })) as ActiveBatch[];
    },
    refetchInterval: POLLING_INTERVALS.FAST,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
  });

  // Fetch vessel status (audit finding F-008: drop the silent fallback to the
  // base table — it hid real regressions in the `vessels_with_batch` view).
  const { data: vessels = [] } = useQuery({
    queryKey: dashboardKeys.vessels(),
    queryFn: async () => {
      const { data, error } = await dynamicFrom(supabase, "vessels_with_batch")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as VesselStatus[];
    },
    refetchInterval: POLLING_INTERVALS.NORMAL,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
  });

  // Fetch production shortfalls
  const { data: shortfalls = [] } = useQuery({
    queryKey: planningKeys.shortfalls({ includeDrafts: true, horizonWeeks: 8 }),
    queryFn: async () => {
      const { data, error } = await dynamicRpc(supabase, "calculate_production_shortfalls", {
        p_include_drafts: true,
        p_horizon_weeks: 8,
      });
      if (error) return [];
      return (data || []) as ProductionShortfall[];
    },
    refetchInterval: POLLING_INTERVALS.NORMAL,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
  });

  // Calculate per-type vessel utilization
  const vesselArray = vessels as VesselStatus[];
  const vesselsByType = VESSEL_TYPES
    .map(({ value, label }) => {
      const ofType = vesselArray.filter((v) => v.vessel_type === value);
      if (ofType.length === 0) return null;
      const inUse = ofType.filter((v) => v.status === "in_use").length;
      return { type: value, label, total: ofType.length, inUse };
    })
    .filter(Boolean) as { type: string; label: string; total: number; inUse: number }[];

  const totalVessels = vesselArray.length;
  const totalInUse = vesselArray.filter((v) => v.status === "in_use").length;
  const utilizationPercent = totalVessels > 0
    ? Math.round((totalInUse / totalVessels) * 100)
    : 0;

  const urgentShortfalls = shortfalls.filter((s) => s.is_urgent);

  // Build stats for the strip
  const primaryStats: StatItem[] = [
    { value: batchCounts.fermenting, label: "fermenting" },
    { value: batchCounts.conditioning, label: "conditioning" },
    { value: batchCounts.packaging, label: "packaging" },
  ];

  if (shortfalls.length > 0) {
    primaryStats.push({
      value: shortfalls.length,
      label: urgentShortfalls.length > 0
        ? `shortfalls (${urgentShortfalls.length} urgent)`
        : "shortfalls",
      href: "/production/planning",
      variant: urgentShortfalls.length > 0 ? "warning" : "default",
    });
  }

  const secondaryStats: StatItem[] = [
    { value: batchCounts.planned, label: "planned" },
    { value: batchCounts.completed, label: "completed" },
  ];

  return (
    <div className="space-y-6">
      {/* Onboarding Checklist (hidden once all steps complete) */}
      <GettingStartedChecklist />

      {/* Header with Stats Strip */}
      <div className="space-y-1">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold">Production Dashboard</h1>
          <div className="flex items-center gap-4">
            <Suspense fallback={null}>
              <PeriodSelector />
            </Suspense>
            <Link
              href="/production/batches"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              View All Batches
            </Link>
          </div>
        </div>
        <StatsStrip stats={primaryStats} secondaryStats={secondaryStats} />
      </div>

      {/* Two-Column Layout */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Active Batches (col-span-3) */}
        <DashboardSection
          title="Active Batches"
          viewAllHref="/production/batches"
          className="lg:col-span-3"
        >
          {activeBatches.length === 0 ? (
            <DashboardEmpty message="No active batches" icon={FlaskConical} />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 font-medium uppercase tracking-wider text-xs text-muted-foreground">Batch</th>
                  <th className="pb-2 font-medium uppercase tracking-wider text-xs text-muted-foreground">Recipe</th>
                  <th className="pb-2 font-medium uppercase tracking-wider text-xs text-muted-foreground text-right">Volume</th>
                  <th className="pb-2 font-medium uppercase tracking-wider text-xs text-muted-foreground text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {activeBatches.slice(0, MAX_BATCHES_SHOWN).map((batch) => (
                  <tr key={batch.id} className="hover:bg-muted/50">
                    <td className="py-2">
                      <Link href={`/production/batches/${batch.id}`} className="hover:underline">
                        <span className="font-mono font-medium">{batch.batch_code}</span>
                      </Link>
                    </td>
                    <td className="py-2 text-muted-foreground truncate max-w-[200px]">
                      {batch.recipe_name || batch.name}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {batch.volume_bbl != null
                        ? `${(Math.round(convertVolume(batch.volume_bbl, "bbl", volumeUnit) * 10) / 10).toLocaleString()} ${volumeLabel}`
                        : "—"}
                    </td>
                    <td className="py-2 text-right">
                      <StatusBadge
                        status={batch.status}
                        config={batchEntity.stateMachine?.stateDisplay}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DashboardSection>

        {/* Vessel Utilization (col-span-2) */}
        <DashboardSection
          title="Vessel Utilization"
          viewAllHref="/production/vessels"
          className="lg:col-span-2"
        >
          {/* Big utilization percentage */}
          <div className="mb-5">
            <span className="font-mono text-4xl font-semibold">{utilizationPercent}%</span>
            <span className="text-muted-foreground ml-2 text-sm">
              in use ({totalInUse}/{totalVessels})
            </span>
          </div>

          {/* Per-Type Progress Bars */}
          <div className="space-y-3">
            {vesselsByType.map(({ type, label, total, inUse }) => (
              <div key={type}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-xs text-muted-foreground font-mono">
                    {inUse}/{total}
                  </span>
                </div>
                <Progress
                  value={total > 0 ? (inUse / total) * 100 : 0}
                  className="h-[3px]"
                />
              </div>
            ))}
          </div>
        </DashboardSection>
      </div>

      {/* Period Trends (wrapped in Suspense for useSearchParams) */}
      <Suspense fallback={<ProductionTrendsSkeleton />}>
        <ProductionTrends />
      </Suspense>
    </div>
  );
}

// =============================================================================
// Production Trends (Suspense child — uses useSearchParams via usePeriod)
// =============================================================================

function ProductionTrendsSkeleton() {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px] rounded-lg" />
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-[248px] rounded-lg" />
        ))}
      </div>
    </>
  );
}

function ProductionTrends() {
  const supabase = createClient();
  const period = usePeriod();
  const volumeUnit = useVolumeUnit();
  const volumeLabel = UNIT_LABELS[volumeUnit];

  // Single 365-day fetch covers both the period-scoped delta cards (sliced
  // client-side) and the year weekly volume chart. Fetching twice would double
  // RPC traffic for no benefit.
  const { data: productionTrends = [], isLoading } = useQuery({
    queryKey: dashboardKeys.trends.production(365),
    queryFn: async () => {
      const { data, error } = await dynamicRpc(supabase, "get_production_trends", {
        p_days: 365,
      });
      if (error) {
        log.error("Failed to fetch production trends:", error);
        return [];
      }
      return (data || []) as Array<{
        date: string;
        batches_started: number;
        volume_bbl: number;
        batches_completed: number;
      }>;
    },
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });

  const currentPeriodData = useMemo(
    () => productionTrends.slice(-period),
    [productionTrends, period],
  );
  const previousPeriodData = useMemo(
    () => productionTrends.slice(-2 * period, -period),
    [productionTrends, period],
  );

  // get_production_trends(p_days) returns 2 * p_days rows (current + comparison
  // period). Slice to the trailing year before bucketing so the chart shows ~52
  // weeks, not ~104.
  const weeklyVolumeData = useMemo(
    () =>
      bucketWeekly(
        productionTrends.slice(-365).map((d) => ({
          date: d.date,
          value: convertVolume(Number(d.volume_bbl), "bbl", volumeUnit),
        })),
      ),
    [productionTrends, volumeUnit],
  );

  if (isLoading) {
    return <ProductionTrendsSkeleton />;
  }

  const currentBatchesStarted = currentPeriodData.reduce((sum, d) => sum + d.batches_started, 0);
  const previousBatchesStarted = previousPeriodData.reduce((sum, d) => sum + d.batches_started, 0);

  // Volume sums come back in BBL from the RPC. Convert to the user's chosen
  // unit so the headline number agrees with the chart below it (audit F-001).
  const currentVolumeBbl = currentPeriodData.reduce((sum, d) => sum + Number(d.volume_bbl), 0);
  const previousVolumeBbl = previousPeriodData.reduce((sum, d) => sum + Number(d.volume_bbl), 0);
  const currentVolumeDisplay = convertVolume(currentVolumeBbl, "bbl", volumeUnit);
  const previousVolumeDisplay = convertVolume(previousVolumeBbl, "bbl", volumeUnit);

  const currentCompleted = currentPeriodData.reduce((sum, d) => sum + d.batches_completed, 0);
  const previousCompleted = previousPeriodData.reduce((sum, d) => sum + d.batches_completed, 0);

  const deltaLabel = `vs prev ${period}d`;

  return (
    <>
      {/* Period Comparison Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCardWithDelta
          value={currentBatchesStarted}
          label="batches scheduled"
          delta={calculateDelta(currentBatchesStarted, previousBatchesStarted)}
          deltaLabel={deltaLabel}
        />
        <StatCardWithDelta
          value={`${(Math.round(currentVolumeDisplay * 10) / 10).toLocaleString()} ${volumeLabel}`}
          label="volume brewed"
          delta={calculateDelta(currentVolumeDisplay, previousVolumeDisplay)}
          deltaLabel={deltaLabel}
        />
        <StatCardWithDelta
          value={currentCompleted}
          label="batches completed"
          delta={calculateDelta(currentCompleted, previousCompleted)}
          deltaLabel={deltaLabel}
        />
      </div>

      {/* Trend Charts */}
      <div className="grid gap-6 md:grid-cols-2">
        <DashboardSection title="Batches Scheduled">
          <BatchActivityHeatmap />
        </DashboardSection>
        <DashboardSection title="Volume Brewed (weekly)">
          <TrendChart
            data={weeklyVolumeData}
            xKey="date"
            type="bar"
            series={[{ key: "value", label: volumeLabel }]}
            formatValue={(v) => `${Number(v).toFixed(1)} ${volumeLabel}`}
            formatTooltipDate={(iso) => `Week of ${format(parseISO(iso), "MMM d, yyyy")}`}
          />
        </DashboardSection>
      </div>
    </>
  );
}
