"use client";

/**
 * Production Planning Page
 *
 * Backward planning from orders - shows:
 * - Demand summary cards
 * - Shortfall table with recommended brew dates
 * - Quick batch creation from shortfalls
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { planningKeys, batchKeys } from "@/lib/query-keys";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  Package,
  AlertTriangle,
  TrendingUp,
  Clock,
  Plus,
  RefreshCw,
  List,
  Calendar,
} from "lucide-react";
import Link from "next/link";
import type {
  ProductionShortfall,
  PlanningFilters,
  PlanningSummary,
} from "@/types/planning";
import { DEFAULT_PLANNING_FILTERS } from "@/types/planning";
import { CreateBatchFromShortfall } from "@/components/domain/create-batch-from-shortfall";

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)("calculate_production_shortfalls", {
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
    inProduction: shortfalls.reduce((sum, s) => sum + s.in_production_cases, 0),
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Production Planning</h1>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
            <Button variant="ghost" size="sm" className="h-7 px-2 bg-background shadow-sm">
              <List className="h-4 w-4 mr-1" />
              List
            </Button>
            <Link href="/production/planning/timeline">
              <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-foreground">
                <Calendar className="h-4 w-4 mr-1" />
                Timeline
              </Button>
            </Link>
          </div>
          <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <Label htmlFor="horizon">Planning Horizon</Label>
              <Select
                value={filters.horizonWeeks.toString()}
                onValueChange={(value) =>
                  setFilters({ ...filters, horizonWeeks: parseInt(value) })
                }
              >
                <SelectTrigger id="horizon" className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="4">4 weeks</SelectItem>
                  <SelectItem value="8">8 weeks</SelectItem>
                  <SelectItem value="12">12 weeks</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="include-drafts"
                checked={filters.includeDrafts}
                onCheckedChange={(checked) =>
                  setFilters({ ...filters, includeDrafts: checked })
                }
              />
              <Label htmlFor="include-drafts">Include draft orders</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Demand</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalDemand.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">cases needed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Available</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.availableSupply.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">cases in stock</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Shortfalls</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.shortfallCount}</div>
            <p className="text-xs text-muted-foreground">products need brewing</p>
          </CardContent>
        </Card>

        <Card className={summary.urgentCount > 0 ? "border-destructive" : ""}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Urgent</CardTitle>
            <AlertTriangle
              className={`h-4 w-4 ${
                summary.urgentCount > 0 ? "text-destructive" : "text-muted-foreground"
              }`}
            />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                summary.urgentCount > 0 ? "text-destructive" : ""
              }`}
            >
              {summary.urgentCount}
            </div>
            <p className="text-xs text-muted-foreground">need immediate action</p>
          </CardContent>
        </Card>
      </div>

      {/* Shortfall Table */}
      <Card>
        <CardHeader>
          <CardTitle>Production Shortfalls</CardTitle>
          <CardDescription>
            Products where demand exceeds available supply. Click &quot;Create Batch&quot; to
            schedule production.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : shortfalls.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">No shortfalls detected</p>
              <p className="text-sm">
                All demand within the {filters.horizonWeeks}-week horizon is covered
              </p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Demand Week</TableHead>
                    <TableHead className="text-right">Demand</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead className="text-right">Shortfall</TableHead>
                    <TableHead>Brew By</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shortfalls.map((shortfall, index) => (
                    <TableRow key={`${shortfall.brand_id}-${shortfall.package_type_id}-${shortfall.demand_week}-${index}`}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{shortfall.brand_name}</div>
                          <div className="text-sm text-muted-foreground">
                            {shortfall.package_type_name}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{formatWeek(shortfall.demand_week)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {shortfall.demand_quantity.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {shortfall.available_quantity.toLocaleString()}
                        {shortfall.in_production_cases > 0 && (
                          <span className="text-muted-foreground text-xs block">
                            +{shortfall.in_production_cases} in prod
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
                          {shortfall.is_urgent && (
                            <AlertTriangle className="h-4 w-4 text-destructive" />
                          )}
                          <span
                            className={
                              isPast(shortfall.recommended_brew_start)
                                ? "text-destructive font-medium"
                                : ""
                            }
                          >
                            {formatDate(shortfall.recommended_brew_start)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {shortfall.lead_time_days} day lead time
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant={shortfall.is_urgent ? "destructive" : "outline"}
                          onClick={() => setSelectedShortfall(shortfall)}
                          disabled={!shortfall.recipe_id}
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          Create Batch
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

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
