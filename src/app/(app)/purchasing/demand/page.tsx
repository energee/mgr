"use client";

/**
 * Ingredient Demand Page
 *
 * Shows ingredient demand from planned/fermenting batches:
 * - Summary cards for demand overview
 * - Filter controls for horizon and ingredient type
 * - Shortfalls table with PO creation actions
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { purchasingKeys } from "@/lib/query-keys";
import {
  calculateIngredientShortfalls,
  calculateIngredientDemand,
  getCatalogTypeDisplay,
} from "@/lib/purchasing/demand-calculator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Package,
  AlertTriangle,
  TrendingUp,
  CheckCircle2,
  RefreshCw,
  ShoppingCart,
} from "lucide-react";
import { IngredientShortfallsTable } from "@/components/domain/ingredient-shortfalls-table";

// =============================================================================
// Types
// =============================================================================

interface DemandFilters {
  horizonWeeks: number;
  catalogType: string; // "_all" or specific type
}

// =============================================================================
// Component
// =============================================================================

export default function IngredientDemandPage() {
  const queryClient = useQueryClient();

  // Filter state
  const [filters, setFilters] = useState<DemandFilters>({
    horizonWeeks: 8,
    catalogType: "_all",
  });

  // Fetch shortfalls
  const {
    data: shortfalls = [],
    isLoading: shortfallsLoading,
    refetch,
  } = useQuery({
    queryKey: purchasingKeys.ingredientShortfalls({ horizonWeeks: filters.horizonWeeks }),
    queryFn: async () => calculateIngredientShortfalls(filters.horizonWeeks),
    refetchInterval: 60000, // Refresh every minute
  });

  // Fetch all demand for summary
  const { data: demand = [] } = useQuery({
    queryKey: purchasingKeys.ingredientDemand({ horizonWeeks: filters.horizonWeeks }),
    queryFn: async () => calculateIngredientDemand(filters.horizonWeeks),
    refetchInterval: 60000,
  });

  // Filter shortfalls by catalog type
  const filteredShortfalls = filters.catalogType === "_all"
    ? shortfalls
    : shortfalls.filter((s) => s.catalog_type === filters.catalogType);

  // Calculate summary stats
  const totalDemandItems = demand.length;
  const shortfallCount = shortfalls.length;
  const urgentCount = shortfalls.filter((s) => s.is_urgent).length;
  const coveredCount = totalDemandItems - shortfallCount;

  // Get unique catalog types for filter
  const catalogTypes = Array.from(new Set(shortfalls.map((s) => s.catalog_type))).sort();

  // Handle PO creation - refresh data
  const handlePOCreated = () => {
    queryClient.invalidateQueries({ queryKey: purchasingKeys.all() });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShoppingCart className="h-6 w-6" />
            Ingredient Demand
          </h1>
          <p className="text-muted-foreground">
            Track ingredient needs from planned production
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => refetch()}
          disabled={shortfallsLoading}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${shortfallsLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
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
              <Label htmlFor="type">Ingredient Type</Label>
              <Select
                value={filters.catalogType}
                onValueChange={(value) =>
                  setFilters({ ...filters, catalogType: value })
                }
              >
                <SelectTrigger id="type" className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Types</SelectItem>
                  {catalogTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {getCatalogTypeDisplay(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <div className="text-2xl font-bold">{totalDemandItems}</div>
            <p className="text-xs text-muted-foreground">ingredients needed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Covered</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{coveredCount}</div>
            <p className="text-xs text-muted-foreground">in stock</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Shortfalls</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{shortfallCount}</div>
            <p className="text-xs text-muted-foreground">need ordering</p>
          </CardContent>
        </Card>

        <Card className={urgentCount > 0 ? "border-destructive" : ""}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Urgent</CardTitle>
            <AlertTriangle
              className={`h-4 w-4 ${
                urgentCount > 0 ? "text-destructive" : "text-muted-foreground"
              }`}
            />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                urgentCount > 0 ? "text-destructive" : ""
              }`}
            >
              {urgentCount}
            </div>
            <p className="text-xs text-muted-foreground">need immediate action</p>
          </CardContent>
        </Card>
      </div>

      {/* Shortfalls Table */}
      <Card>
        <CardHeader>
          <CardTitle>Ingredient Shortfalls</CardTitle>
          <CardDescription>
            Ingredients where demand exceeds available inventory. Create POs to order what you need.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <IngredientShortfallsTable
            shortfalls={filteredShortfalls}
            isLoading={shortfallsLoading}
            onPOCreated={handlePOCreated}
          />
        </CardContent>
      </Card>
    </div>
  );
}
