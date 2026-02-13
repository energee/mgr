"use client";

/**
 * Inventory Dashboard
 *
 * Overview of inventory metrics:
 * - Low stock alerts
 * - Expiring lots
 * - Inventory summary by category
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dashboardKeys } from "@/lib/query-keys";
import Link from "next/link";
import { InventoryAlerts } from "@/components/domain/inventory-alerts";
import { StatsStrip, DashboardSection, DashboardEmpty } from "@/components/dashboard";
import type { StatItem } from "@/components/dashboard";
import { StatusBadge } from "@/components/universal/status-badge";

// =============================================================================
// Types
// =============================================================================

interface LowStockItem {
  id: string;
  name: string;
  category: string;
  current_qty: number;
  reorder_point: number;
  unit: string;
}

interface ExpiringLot {
  id: string;
  item_name: string;
  lot_number: string;
  expiration_date: string;
  quantity: number;
  unit: string;
  days_until_expiry: number;
}

interface InventorySummary {
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
  if (days < 0) return "error";
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: lowStockItems = [] } = useQuery({
    queryKey: dashboardKeys.lowStock(),
    queryFn: async () => {
      const { data, error } = await db
        .from("inventory_low_stock_items")
        .select("id, name, category, unit, reorder_point, current_qty")
        .order("name");

      if (error) throw error;

      return (data || []).map((item: LowStockItem) => ({
        ...item,
        category: item.category || "other",
        unit: item.unit || "units",
      })) as LowStockItem[];
    },
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });

  // Fetch expiring lots (lots expiring within 90 days)
  const { data: expiringLots = [] } = useQuery({
    queryKey: dashboardKeys.expiringLots(),
    queryFn: async () => {
      const ninetyDaysFromNow = new Date();
      ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90);

      const { data, error } = await supabase
        .from("inventory_lots")
        .select(`
          id,
          lot_number,
          expiration_date,
          quantity,
          unit,
          inventory_items:inventory_item_id(name)
        `)
        .not("expiration_date", "is", null)
        .lte("expiration_date", ninetyDaysFromNow.toISOString().split("T")[0])
        .gt("quantity", 0)
        .order("expiration_date", { ascending: true })
        .limit(20);

      if (error) throw error;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      return (data || [])
        .filter((lot) => lot.expiration_date !== null)
        .map((lot) => {
          const expDate = new Date(lot.expiration_date as string);
          expDate.setHours(0, 0, 0, 0);
          const diffTime = expDate.getTime() - today.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const itemInfo = lot.inventory_items as any;

          return {
            id: lot.id,
            item_name: itemInfo?.name || "Unknown",
            lot_number: lot.lot_number || "N/A",
            expiration_date: lot.expiration_date as string,
            quantity: lot.quantity,
            unit: lot.unit || "units",
            days_until_expiry: diffDays,
          };
        }) as ExpiringLot[];
    },
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });

  // Fetch inventory summary by category (pre-aggregated view)
  const { data: inventorySummary = [] } = useQuery({
    queryKey: dashboardKeys.inventorySummary(),
    queryFn: async () => {
      const { data, error } = await db
        .from("inventory_summary_by_category")
        .select("category, item_count, total_value");

      if (error) throw error;
      return (data || []) as InventorySummary[];
    },
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
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
          <Link
            href="/inventory/items"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            View All Items
          </Link>
        </div>
        <StatsStrip stats={primaryStats} />
      </div>

      {/* Two-Column Layout */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Low Stock Items */}
        <DashboardSection title="Low Stock Items" viewAllHref="/inventory/items">
          {lowStockItems.length === 0 ? (
            <DashboardEmpty message="All items are stocked" />
          ) : (
            <div className="divide-y">
              {lowStockItems.slice(0, MAX_ITEMS_SHOWN).map((item) => {
                const percentOfReorder = Math.round((item.current_qty / item.reorder_point) * 100);

                return (
                  <Link
                    key={item.id}
                    href={`/inventory/items/${item.id}`}
                    className="flex items-center justify-between py-2 hover:bg-muted/50 -mx-1 px-1"
                  >
                    <div>
                      <div className="font-medium text-sm">{item.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Reorder: <span className="font-mono">{item.reorder_point}</span> {item.unit}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-mono font-semibold text-amber-600">
                        {item.current_qty} {item.unit}
                      </span>
                      <span className="text-xs text-muted-foreground ml-2">
                        ({percentOfReorder}%)
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </DashboardSection>

        {/* Expiring Lots */}
        <DashboardSection title="Expiring Lots">
          {expiringLots.length === 0 ? (
            <DashboardEmpty message="No lots expiring soon" />
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
                      Lot: {lot.lot_number} · <span className="font-mono">{lot.quantity}</span> {lot.unit}
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

      {/* AI-Powered Inventory Overview */}
      <InventoryAlerts autoExpandOnAlerts={false} />
    </div>
  );
}
