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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  Beer,
  FlaskConical,
  Package,
  CheckCircle,
  Clock,
  AlertTriangle,
  Container,
  ArrowRight,
  Activity,
} from "lucide-react";

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
// Status Configuration
// =============================================================================

const statusConfig = {
  planned: { label: "Planned", icon: Clock, color: "bg-slate-500" },
  fermenting: { label: "Fermenting", icon: FlaskConical, color: "bg-blue-500" },
  conditioning: { label: "Conditioning", icon: Beer, color: "bg-cyan-500" },
  packaging: { label: "Packaging", icon: Package, color: "bg-amber-500" },
  completed: { label: "Completed", icon: CheckCircle, color: "bg-green-500" },
};

const vesselStatusConfig = {
  available: { label: "Available", color: "default" as const },
  in_use: { label: "In Use", color: "secondary" as const },
  cleaning: { label: "Cleaning", color: "outline" as const },
  maintenance: { label: "Maintenance", color: "destructive" as const },
};

// =============================================================================
// Component
// =============================================================================

export default function DashboardPage() {
  const supabase = createClient();

  // Fetch batch status counts
  const { data: batchCounts = { planned: 0, fermenting: 0, conditioning: 0, packaging: 0, completed: 0 } } = useQuery({
    queryKey: ["dashboard", "batch-counts"],
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
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch active batches (not completed or cancelled)
  const { data: activeBatches = [] } = useQuery({
    queryKey: ["dashboard", "active-batches"],
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
    queryKey: ["dashboard", "vessels"],
    queryFn: async () => {
      // Use vessels_with_batch view if available, otherwise base table
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { data, error } = await db
        .from("vessels_with_batch")
        .select("*")
        .order("name");

      if (error) {
        // Fallback to base table
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

  // Calculate vessel utilization
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vesselArray = vessels as any[];
  const vesselStats = {
    total: vesselArray.length,
    inUse: vesselArray.filter((v) => v.status === "in_use").length,
    available: vesselArray.filter((v) => v.status === "available").length,
    maintenance: vesselArray.filter((v) => v.status === "maintenance" || v.status === "cleaning").length,
  };

  const utilizationPercent = vesselStats.total > 0
    ? Math.round((vesselStats.inUse / vesselStats.total) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Activity className="h-6 w-6" />
          Production Dashboard
        </h1>
        <p className="text-muted-foreground">
          Overview of production status and vessel utilization
        </p>
      </div>

      {/* Batch Status Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {Object.entries(statusConfig).map(([status, config]) => {
          const Icon = config.icon;
          const count = batchCounts[status as keyof BatchStatusCounts] || 0;

          return (
            <Card key={status}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{config.label}</CardTitle>
                <div className={`p-2 rounded-full ${config.color}`}>
                  <Icon className="h-4 w-4 text-white" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{count}</div>
                <p className="text-xs text-muted-foreground">
                  {count === 1 ? "batch" : "batches"}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Active Batches */}
        <Card className="md:col-span-1">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Active Batches</CardTitle>
                <CardDescription>Batches currently in production</CardDescription>
              </div>
              <Link href="/production/batches">
                <Button variant="outline" size="sm">
                  View All
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {activeBatches.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <FlaskConical className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No active batches</p>
              </div>
            ) : (
              <div className="space-y-3">
                {activeBatches.slice(0, 5).map((batch) => {
                  const config = statusConfig[batch.status as keyof typeof statusConfig];
                  return (
                    <Link
                      key={batch.id}
                      href={`/production/batches/${batch.id}`}
                      className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{batch.batch_number}</div>
                        <div className="text-sm text-muted-foreground truncate">
                          {batch.recipe_name || batch.name}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {batch.volume_bbl && (
                          <span className="text-sm text-muted-foreground">
                            {batch.volume_bbl} BBL
                          </span>
                        )}
                        <Badge variant="secondary" className="flex items-center gap-1">
                          {config && <config.icon className="h-3 w-3" />}
                          {config?.label || batch.status}
                        </Badge>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Vessel Utilization */}
        <Card className="md:col-span-1">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Vessel Utilization</CardTitle>
                <CardDescription>Current vessel status overview</CardDescription>
              </div>
              <Link href="/production/vessels">
                <Button variant="outline" size="sm">
                  View All
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {/* Utilization Bar */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Utilization</span>
                <span className="text-2xl font-bold">{utilizationPercent}%</span>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-500"
                  style={{ width: `${utilizationPercent}%` }}
                />
              </div>
              <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                <span>{vesselStats.inUse} in use</span>
                <span>{vesselStats.available} available</span>
              </div>
            </div>

            {/* Vessel Status Summary */}
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <Container className="h-5 w-5 mx-auto mb-1 text-blue-500" />
                <div className="text-lg font-bold">{vesselStats.inUse}</div>
                <div className="text-xs text-muted-foreground">In Use</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <CheckCircle className="h-5 w-5 mx-auto mb-1 text-green-500" />
                <div className="text-lg font-bold">{vesselStats.available}</div>
                <div className="text-xs text-muted-foreground">Available</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <AlertTriangle className="h-5 w-5 mx-auto mb-1 text-amber-500" />
                <div className="text-lg font-bold">{vesselStats.maintenance}</div>
                <div className="text-xs text-muted-foreground">Maint.</div>
              </div>
            </div>

            {/* Vessel List */}
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {vesselArray.slice(0, 8).map((vessel) => (
                <Link
                  key={vessel.id}
                  href={`/production/vessels/${vessel.id}`}
                  className="flex items-center justify-between p-2 rounded border hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Container className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">{vessel.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {vessel.current_batch_name && (
                      <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                        {vessel.current_batch_name}
                      </span>
                    )}
                    <Badge
                      variant={vesselStatusConfig[vessel.status as keyof typeof vesselStatusConfig]?.color || "default"}
                    >
                      {vesselStatusConfig[vessel.status as keyof typeof vesselStatusConfig]?.label || vessel.status}
                    </Badge>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
