"use client";

/**
 * Inventory Dashboard
 *
 * Overview of inventory metrics:
 * - Low stock alerts (each row links to the item, with a "Reorder" shortcut
 *   into PO creation and a section link to material planning)
 * - Expiring lots
 * - Inventory summary by category
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dashboardKeys } from "@/lib/query-keys";
import Link from "next/link";
import { InventoryAlerts } from "@/components/domain/inventory/inventory-alerts";
import { Suspense } from "react";
import { PackageCheck, Clock, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatsStrip, DashboardSection, DashboardEmpty, PeriodSelector, usePeriod, StatCardWithDelta, calculateDelta, TrendChart } from "@/components/dashboard";
import type { StatItem } from "@/components/dashboard";
import { StatusBadge } from "@/components/universal/status-badge";
import { CACHE_DURATIONS, POLLING_INTERVALS } from "@/lib/constants";
import { dynamicFrom, dynamicRpc, formatServiceError } from "@/services/types";
import { inventoryService, type ExpiringLot } from "@/services/inventory-service";
import { Skeleton } from "@/components/ui/skeleton";
import { log } from "@/lib/client-logger";
import { unwrap } from "@/lib/supabase/query-helpers";

// =============================================================================
// Types
// =============================================================================

type LowStockItem = {
  id: string;
  name: string;
  category: string;
  current_qty: number;
  reorder_point: number;
  unit: string;
}

type InventorySummary = {
  category: string;
  item_count: number;
  total_value: number;
}

// =============================================================================
// Constants
// =============================================================================

const MAX_ITEMS_SHOWN = 8;

// =============================================================================
// Helper Functions
// =============================================================================

function getExpiryVariant(days: number): "default" | "warning" | "error" {
  if (days <= 7) return "error";
  if (days <= 30) return "warning";
  return "default";
}

function getExpiryText(days: number): string {
  if (days < 0) return "Expired";
  if (days === 0) return "Today";
  return `${days}d`;
}

// =============================================================================
// Component
// =============================================================================

export default function InventoryDashboardPage() {
  const supabase = createClient();

  // Fetch low stock items (pre-filtered view)
  const { data: lowStockItems = [] } = useQuery({
    queryKey: dashboardKeys.lowStock(),
    queryFn: async () => {
      const data = await unwrap(
        dynamicFrom(supabase, "inventory_low_stock_items")
          .select("id, name, category, unit, reorder_point, current_qty")
          .order("name")
      ) as unknown as LowStockItem[];

      return (data || []).map((item: LowStockItem) => ({
        ...item,
        category: item.category || "other",
        unit: item.unit || "units",
      })) as LowStockItem[];
    },
    refetchInterval: POLLING_INTERVALS.NORMAL,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
  });

  // Lots expiring in the next 90 days, excluding fully-allocated ones.
  // Filtering happens server-side on the inventory_lots_with_quantities view —
  // see inventoryService.getExpiringLots and migration 00172 for why filtering
  // on the base table's `quantity` column would silently include depleted lots.
  const { data: expiringLots = [] } = useQuery<ExpiringLot[]>({
    queryKey: dashboardKeys.expiringLots(),
    queryFn: async () => {
      const result = await inventoryService.getExpiringLots(supabase, 90, 20);
      if (!result.success) throw new Error(formatServiceError(result.error));
      return result.data;
    },
    refetchInterval: POLLING_INTERVALS.NORMAL,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
  });

  // Fetch inventory summary by category (pre-aggregated view)
  const { data: inventorySummary = [] } = useQuery({
    queryKey: dashboardKeys.inventorySummary(),
    queryFn: async () => {
      return await unwrap(
        dynamicFrom(supabase, "inventory_summary_by_category")
          .select("category, item_count, total_value")
      ) as unknown as InventorySummary[];
    },
    refetchInterval: POLLING_INTERVALS.NORMAL,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
  });

  // Calculate totals
  const lowStockCount = lowStockItems.length;
  const expiringCount = expiringLots.filter((lot) => lot.days_until_expiry <= 30).length;
  const totalItems = inventorySummary.reduce((sum, cat) => sum + cat.item_count, 0);

  // Build stats for the strip
  const primaryStats: StatItem[] = [
    {
      value: lowStockCount,
      label: "low stock",
      variant: lowStockCount > 0 ? "warning" : "default",
    },
    {
      value: expiringCount,
      label: "expiring soon",
      variant: expiringCount > 0 ? "warning" : "default",
    },
    { value: totalItems, label: "total items" },
  ];

  return (
    <div className="space-y-6">
      {/* Header with Stats Strip */}
      <div className="space-y-1">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold">Inventory Dashboard</h1>
          <div className="flex items-center gap-4">
            <Suspense fallback={null}>
              <PeriodSelector />
            </Suspense>
            <Link
              href="/inventory/items"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              View All Items
            </Link>
          </div>
        </div>
        <StatsStrip stats={primaryStats} />
      </div>

      {/* Two-Column Layout */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Low Stock Items */}
        <DashboardSection title="Low Stock Items" viewAllHref="/inventory/items">
          {lowStockItems.length === 0 ? (
            <DashboardEmpty message="All items are stocked" icon={PackageCheck} />
          ) : (
            <>
              <div className="divide-y">
                {lowStockItems.slice(0, MAX_ITEMS_SHOWN).map((item) => {
                  const percentOfReorder = Math.round((item.current_qty / item.reorder_point) * 100);

                  return (
                    <div key={item.id} className="flex items-center gap-2 py-2">
                      <Link
                        href={`/inventory/items/${item.id}`}
                        className="flex flex-1 items-center justify-between gap-3 min-w-0 hover:bg-muted/50 -mx-1 px-1 rounded"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">{item.name}</div>
                          <div className="text-xs text-muted-foreground">
                            Reorder: <span className="font-mono">{item.reorder_point}</span> {item.unit}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-mono font-semibold text-amber-600">
                            {item.current_qty} {item.unit}
                          </span>
                          <span className="text-xs text-muted-foreground ml-2">
                            ({percentOfReorder}%)
                          </span>
                        </div>
                      </Link>
                      {/* Shortcut to the resolving purchase action (draft PO) */}
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="shrink-0 h-7 px-2 text-xs"
                      >
                        <Link href="/purchasing/pos/new" aria-label={`Reorder ${item.name}`}>
                          <ShoppingCart className="h-3.5 w-3.5 mr-1" />
                          Reorder
                        </Link>
                      </Button>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                <Link
                  href="/purchasing/material-planning"
                  className="hover:text-foreground underline underline-offset-2"
                >
                  Plan upcoming material purchases →
                </Link>
              </p>
            </>
          )}
        </DashboardSection>

        {/* Expiring Lots */}
        <DashboardSection title="Expiring Lots">
          {expiringLots.length === 0 ? (
            <DashboardEmpty message="No lots expiring soon" icon={Clock} />
          ) : (
            <div className="divide-y">
              {expiringLots.slice(0, MAX_ITEMS_SHOWN).map((lot) => (
                <div
                  key={lot.id}
                  className="flex items-center justify-between py-2"
                >
                  <div>
                    <div className="font-medium text-sm">{lot.item_name}</div>
                    <div className="text-xs text-muted-foreground">
                      Lot: {lot.lot_number} · <span className="font-mono">{lot.remaining_quantity}</span> {lot.unit}
                    </div>
                  </div>
                  <StatusBadge
                    status={getExpiryText(lot.days_until_expiry)}
                    variant={getExpiryVariant(lot.days_until_expiry)}
                  />
                </div>
              ))}
            </div>
          )}
        </DashboardSection>
      </div>

      {/* Inventory by Category */}
      <DashboardSection title="Inventory by Category">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {inventorySummary.map((summary) => (
            <span key={summary.category} className="text-sm">
              <span className="font-mono font-semibold">{summary.item_count}</span>
              <span className="text-muted-foreground ml-1 capitalize">{summary.category}</span>
              {summary.total_value > 0 && (
                <span className="text-muted-foreground ml-1 font-mono">
                  (${summary.total_value.toLocaleString()})
                </span>
              )}
            </span>
          ))}
        </div>
      </DashboardSection>

      {/* Period Trends (wrapped in Suspense for useSearchParams) */}
      <Suspense fallback={<InventoryTrendsSkeleton />}>
        <InventoryTrends />
      </Suspense>

      {/* AI-Powered Inventory Overview */}
      <InventoryAlerts autoExpandOnAlerts={false} />
    </div>
  );
}

// =============================================================================
// Inventory Trends (Suspense child — uses useSearchParams via usePeriod)
// =============================================================================

function InventoryTrendsSkeleton() {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-[248px] rounded-lg" />
    </>
  );
}

function InventoryTrends() {
  const supabase = createClient();
  const period = usePeriod();

  const { data: inventoryTrends = [], isLoading } = useQuery({
    queryKey: dashboardKeys.trends.inventory(period),
    queryFn: async () => {
      const { data, error } = await dynamicRpc(supabase, "get_inventory_trends", {
        p_days: period,
      });
      if (error) {
        log.error("Failed to fetch inventory trends:", error);
        return [];
      }
      return (data || []) as Array<{
        date: string;
        lots_created: number;
        lots_depleted: number;
        total_lot_activity: number;
      }>;
    },
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });

  if (isLoading) {
    return <InventoryTrendsSkeleton />;
  }

  const currentPeriodData = inventoryTrends.slice(period);
  const previousPeriodData = inventoryTrends.slice(0, period);

  const currentLotsCreated = currentPeriodData.reduce((sum, d) => sum + d.lots_created, 0);
  const previousLotsCreated = previousPeriodData.reduce((sum, d) => sum + d.lots_created, 0);

  const currentLotsDepleted = currentPeriodData.reduce((sum, d) => sum + d.lots_depleted, 0);
  const previousLotsDepleted = previousPeriodData.reduce((sum, d) => sum + d.lots_depleted, 0);

  const deltaLabel = `vs prev ${period}d`;

  return (
    <>
      {/* Period Comparison Cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCardWithDelta
          value={currentLotsCreated}
          label="lots received"
          delta={calculateDelta(currentLotsCreated, previousLotsCreated)}
          deltaLabel={deltaLabel}
        />
        <StatCardWithDelta
          value={currentLotsDepleted}
          label="lots consumed"
          delta={calculateDelta(currentLotsDepleted, previousLotsDepleted)}
          deltaLabel={deltaLabel}
        />
      </div>

      {/* Lot Activity Trend */}
      <DashboardSection title="Lot Activity">
        <TrendChart
          data={currentPeriodData}
          xKey="date"
          type="bar"
          series={[
            { key: "lots_created", label: "Received", color: "hsl(var(--chart-1))" },
            { key: "lots_depleted", label: "Consumed", color: "hsl(var(--chart-2))" },
          ]}
        />
      </DashboardSection>
    </>
  );
}
