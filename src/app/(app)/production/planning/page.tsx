"use client";

/**
 * Production Planning Page
 *
 * Backward planning from orders - shows:
 * - Demand summary in stats strip
 * - Shortfall table with recommended brew dates
 * - Quick batch creation from shortfalls
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { planningKeys, batchKeys } from "@/lib/query-keys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import type {
  ProductionShortfall,
  PlanningFilters,
  PlanningSummary,
} from "@/types/planning";
import { DEFAULT_PLANNING_FILTERS } from "@/types/planning";
import { CreateBatchFromShortfall } from "@/components/domain/create-batch-from-shortfall";
import { StatsStrip } from "@/components/dashboard";
import { dynamicRpc } from "@/services/types";

// =============================================================================
// Component
// =============================================================================

export default function ProductionPlanningPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  // Filter state
  const [filters, setFilters] = useState<PlanningFilters>(DEFAULT_PLANNING_FILTERS);

  // Dialog state for batch creation
  const [selectedShortfall, setSelectedShortfall] = useState<ProductionShortfall | null>(null);

  // Fetch shortfalls using the database function
  // Note: Type assertion needed until supabase types are regenerated with migration 00051
  const {
    data: shortfalls = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: planningKeys.shortfalls(filters),
    queryFn: async () => {
      const { data, error } = await dynamicRpc(supabase, "calculate_production_shortfalls", {
        p_include_drafts: filters.includeDrafts,
        p_horizon_weeks: filters.horizonWeeks,
      });

      if (error) throw error;
      return (data || []) as ProductionShortfall[];
    },
    refetchInterval: 60000, // Refresh every minute
  });

  // Calculate summary stats
  const summary: PlanningSummary = {
    totalDemand: shortfalls.reduce((sum, s) => sum + s.demand_quantity, 0),
    availableSupply: shortfalls.reduce((sum, s) => sum + s.available_quantity, 0),
    inProduction: shortfalls.reduce((sum, s) => sum + s.in_production_units, 0),
    shortfallCount: shortfalls.length,
    urgentCount: shortfalls.filter((s) => s.is_urgent).length,
  };

  // Handle batch creation success
  const handleBatchCreated = () => {
    setSelectedShortfall(null);
    // Invalidate both planning and batch queries
    queryClient.invalidateQueries({ queryKey: planningKeys.all() });
    queryClient.invalidateQueries({ queryKey: batchKeys.all() });
  };

  // Format date for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Format week for display
  const formatWeek = (dateStr: string) => {
    const date = new Date(dateStr);
    return `Week of ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  };

  // Check if date is in the past
  const isPast = (dateStr: string) => {
    return new Date(dateStr) < new Date();
  };

  return (
    <div className="space-y-6">
      {/* Header with stats strip */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold">Production Planning</h1>
            {/* Planning sub-views (audit F-023: previously this tab bar omitted
                the Orders link, dead-ending users on Shortfalls. Also renamed
                "List" to "Shortfalls" to match the other two pages' tab labels.) */}
            <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5 text-sm">
              <Button variant="ghost" size="sm" className="h-7 px-3 bg-background shadow-sm">
                Shortfalls
              </Button>
              <Link href="/production/planning/backward">
                <Button variant="ghost" size="sm" className="h-7 px-3 text-muted-foreground hover:text-foreground">
                  Orders
                </Button>
              </Link>
              <Link href="/production/planning/timeline">
                <Button variant="ghost" size="sm" className="h-7 px-3 text-muted-foreground hover:text-foreground">
                  Timeline
                </Button>
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Inline filters */}
            <Select
              value={filters.horizonWeeks.toString()}
              onValueChange={(value) =>
                setFilters({ ...filters, horizonWeeks: parseInt(value) })
              }
            >
              <SelectTrigger className="w-[120px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="4">4 weeks</SelectItem>
                <SelectItem value="8">8 weeks</SelectItem>
                <SelectItem value="12">12 weeks</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Switch
                id="include-drafts"
                checked={filters.includeDrafts}
                onCheckedChange={(checked) =>
                  setFilters({ ...filters, includeDrafts: checked })
                }
              />
              <Label htmlFor="include-drafts" className="text-sm">Drafts</Label>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Stats strip */}
        <StatsStrip
          stats={[
            { value: summary.totalDemand.toLocaleString(), label: "demand" },
            { value: summary.availableSupply.toLocaleString(), label: "available" },
            { value: summary.shortfallCount, label: "shortfalls" },
            ...(summary.urgentCount > 0
              ? [{ value: summary.urgentCount, label: "urgent", variant: "warning" as const }]
              : []),
          ]}
          secondaryStats={[
            { value: summary.inProduction.toLocaleString(), label: "in production" },
          ]}
        />
      </div>

      {/* Shortfall Table */}
      <div className="rounded-lg border bg-card">
        <div className="p-4 border-b">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Production Shortfalls
          </h2>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : shortfalls.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            No shortfalls — all demand within {filters.horizonWeeks} weeks is covered
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="uppercase tracking-wider text-xs">Product</TableHead>
                <TableHead className="uppercase tracking-wider text-xs">Demand Week</TableHead>
                <TableHead className="uppercase tracking-wider text-xs text-right">Demand</TableHead>
                <TableHead className="uppercase tracking-wider text-xs text-right">Available</TableHead>
                <TableHead className="uppercase tracking-wider text-xs text-right">Shortfall</TableHead>
                <TableHead className="uppercase tracking-wider text-xs">Brew By</TableHead>
                <TableHead className="uppercase tracking-wider text-xs text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shortfalls.map((shortfall, index) => {
                const overdue = isPast(shortfall.recommended_brew_start);
                return (
                <TableRow key={`${shortfall.brand_id}-${shortfall.selling_format_id}-${shortfall.demand_week}-${index}`}>
                  <TableCell>
                    <div className="font-medium">{shortfall.brand_name}</div>
                    <div className="text-sm text-muted-foreground">
                      {shortfall.selling_format_name}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{formatWeek(shortfall.demand_week)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {shortfall.demand_quantity.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-mono">{shortfall.available_quantity.toLocaleString()}</span>
                    {shortfall.in_production_units > 0 && (
                      <span className="text-muted-foreground text-xs block">
                        +{shortfall.in_production_units} in prod
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant={shortfall.is_urgent ? "destructive" : "secondary"}>
                      {shortfall.shortfall_quantity.toLocaleString()}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          overdue
                            ? "text-destructive font-medium"
                            : ""
                        }
                      >
                        {formatDate(shortfall.recommended_brew_start)}
                      </span>
                      {overdue && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                          OVERDUE
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {shortfall.lead_time_days}d lead time
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedShortfall(shortfall)}
                      disabled={!shortfall.recipe_id}
                    >
                      Create Batch
                    </Button>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Create Batch Dialog */}
      {selectedShortfall && (
        <CreateBatchFromShortfall
          shortfall={selectedShortfall}
          open={!!selectedShortfall}
          onOpenChange={(open) => !open && setSelectedShortfall(null)}
          onSuccess={handleBatchCreated}
        />
      )}
    </div>
  );
}
