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
import { vesselEntity } from "@/entities/vessel";
import { batchEntity } from "@/entities/batch";
import { StatusBadge } from "@/components/universal/status-badge";
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
  type: string;
  status: string;
  current_batch_name?: string;
  capacity_bbl: number | null;
}

// =============================================================================
// Constants
// =============================================================================

const MAX_BATCHES_SHOWN = 8;
const MAX_VESSELS_SHOWN = 10;

// =============================================================================
// Component
// =============================================================================

export default function DashboardPage() {
  const supabase = createClient();

  // Fetch batch status counts
  const { data: batchCounts = { planned: 0, fermenting: 0, conditioning: 0, packaging: 0, completed: 0 } } = useQuery({
    queryKey: dashboardKeys.batchCounts(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("batches")
        .select("status");

      if (error) throw error;

      const counts: BatchStatusCounts = {
        planned: 0,
        fermenting: 0,
        conditioning: 0,
        packaging: 0,
        completed: 0,
      };

      data?.forEach((batch) => {
        const status = batch.status as keyof BatchStatusCounts;
        if (counts[status] !== undefined) {
          counts[status]++;
        }
      });

      return counts;
    },
    refetchInterval: 30000,
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
    refetchInterval: 30000,
  });

  // Fetch vessel status
  const { data: vessels = [] } = useQuery({
    queryKey: dashboardKeys.vessels(),
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
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
    refetchInterval: 30000,
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
    refetchInterval: 60000,
  });

  const urgentShortfalls = shortfalls.filter((s) => s.is_urgent);

  // Calculate vessel utilization
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vesselArray = vessels as any[];
  const vesselStats = {
    total: vesselArray.length,
    inUse: vesselArray.filter((v) => v.status === "in_use").length,
    available: vesselArray.filter((v) => v.status === "ready_for_use").length,
    maintenance: vesselArray.filter((v) =>
      v.status === "maintenance" || v.status === "dirty" || v.status === "caustic_cleaned"
    ).length,
  };

  const utilizationPercent = vesselStats.total > 0
    ? Math.round((vesselStats.inUse / vesselStats.total) * 100)
    : 0;

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
      <div className="grid gap-6 grid-cols-5">
        {/* Active Batches (col-span-3) */}
        <DashboardSection
          title="Active Batches"
          viewAllHref="/production/batches"
          className="col-span-3"
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
          className="col-span-2"
        >
          {/* Big utilization percentage */}
          <div className="mb-4">
            <span className="font-mono text-4xl font-semibold">{utilizationPercent}%</span>
            <span className="text-muted-foreground ml-2 text-sm">in use</span>
          </div>

          {/* Segmented Tri-Color Bar */}
          <div className="mb-4">
            <div className="h-3 rounded-full overflow-hidden flex bg-muted">
              {vesselStats.total > 0 && (
                <>
                  <div
                    className="h-full bg-orange-500 transition-all duration-500"
                    style={{ width: `${(vesselStats.inUse / vesselStats.total) * 100}%` }}
                    title={`${vesselStats.inUse} in use`}
                  />
                  <div
                    className="h-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${(vesselStats.available / vesselStats.total) * 100}%` }}
                    title={`${vesselStats.available} available`}
                  />
                  <div
                    className="h-full bg-slate-400 transition-all duration-500"
                    style={{ width: `${(vesselStats.maintenance / vesselStats.total) * 100}%` }}
                    title={`${vesselStats.maintenance} maintenance`}
                  />
                </>
              )}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-orange-500" />
                <span className="font-mono font-medium">{vesselStats.inUse}</span> in use
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="font-mono font-medium">{vesselStats.available}</span> available
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-slate-400" />
                <span className="font-mono font-medium">{vesselStats.maintenance}</span> other
              </span>
            </div>
          </div>

          {/* Dense Vessel List */}
          <div className="divide-y max-h-[240px] overflow-y-auto">
            {vesselArray.slice(0, MAX_VESSELS_SHOWN).map((vessel) => (
              <Link
                key={vessel.id}
                href={`/production/vessels/${vessel.id}`}
                className="flex items-center justify-between py-2 hover:bg-muted/50 -mx-1 px-1"
              >
                <span className="font-medium text-sm">{vessel.name}</span>
                <div className="flex items-center gap-2">
                  {vessel.current_batch_name && (
                    <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                      {vessel.current_batch_name}
                    </span>
                  )}
                  <StatusBadge
                    status={vessel.status}
                    config={vesselEntity.stateMachine?.stateDisplay}
                  />
                </div>
              </Link>
            ))}
          </div>
        </DashboardSection>
      </div>
    </div>
  );
}
