"use client";

/**
 * Production Dashboard
 *
 * Overview of production metrics:
 * - Batch status summary
 * - Active batches list
 * - Vessel utilization
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dashboardKeys, planningKeys } from "@/lib/query-keys";
import type { ProductionShortfall } from "@/types/planning";
import Link from "next/link";
import { CACHE_DURATIONS, POLLING_INTERVALS } from "@/lib/constants";
import { VESSEL_TYPES } from "@/entities/vessel";
import { batchEntity } from "@/entities/batch";
import { StatusBadge } from "@/components/universal/status-badge";
import { Progress } from "@/components/ui/progress";
import { StatsStrip, DashboardSection, DashboardEmpty } from "@/components/dashboard";
import type { StatItem } from "@/components/dashboard";

// =============================================================================
// Types
// =============================================================================

interface BatchStatusCounts {
  planned: number;
  fermenting: number;
  conditioning: number;
  packaging: number;
  completed: number;
}

interface ActiveBatch {
  id: string;
  batch_number: string;
  name: string;
  status: string;
  volume_bbl: number | null;
  planned_start_date: string | null;
  recipe_name?: string;
}

interface VesselStatus {
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
// Component
// =============================================================================

export default function DashboardPage() {
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: batchCounts = DEFAULT_BATCH_COUNTS } = useQuery({
    queryKey: dashboardKeys.batchCounts(),
    queryFn: async () => {
      const { data, error } = await db
        .from("batch_status_counts")
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
          batch_number,
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

  // Fetch vessel status
  const { data: vessels = [] } = useQuery({
    queryKey: dashboardKeys.vessels(),
    queryFn: async () => {
      const { data, error } = await db
        .from("vessels_with_batch")
        .select("*")
        .order("name");

      if (error) {
        const { data: fallback } = await supabase
          .from("vessels")
          .select("*")
          .order("name");
        return fallback || [];
      }

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)("calculate_production_shortfalls", {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vesselArray = vessels as any[];
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
      {/* Header with Stats Strip */}
      <div className="space-y-1">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold">Production Dashboard</h1>
          <Link
            href="/production/batches"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            View All Batches
          </Link>
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
            <DashboardEmpty message="No active batches" />
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
                        <span className="font-mono font-medium">{batch.batch_number}</span>
                      </Link>
                    </td>
                    <td className="py-2 text-muted-foreground truncate max-w-[200px]">
                      {batch.recipe_name || batch.name}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {batch.volume_bbl ? `${batch.volume_bbl} BBL` : "—"}
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
    </div>
  );
}
