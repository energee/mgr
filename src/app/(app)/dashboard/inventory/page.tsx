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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  Package,
  AlertTriangle,
  Calendar,
  TrendingDown,
  ArrowRight,
  Boxes,
  Wheat,
  Hop,
  Beaker,
  PackageCheck,
} from "lucide-react";
import { InventoryAlerts } from "@/components/domain/inventory-alerts";

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
// Category Configuration
// =============================================================================

const categoryConfig: Record<string, { icon: typeof Package; color: string }> = {
  malt: { icon: Wheat, color: "bg-amber-500" },
  hops: { icon: Hop, color: "bg-green-500" },
  yeast: { icon: Beaker, color: "bg-purple-500" },
  adjuncts: { icon: Boxes, color: "bg-blue-500" },
  packaging: { icon: PackageCheck, color: "bg-slate-500" },
};

// =============================================================================
// Helper Functions
// =============================================================================

function formatDaysUntilExpiry(days: number): { text: string; variant: "destructive" | "warning" | "default" } {
  if (days < 0) return { text: "Expired", variant: "destructive" };
  if (days === 0) return { text: "Expires today", variant: "destructive" };
  if (days <= 7) return { text: `${days}d`, variant: "destructive" };
  if (days <= 30) return { text: `${days}d`, variant: "warning" };
  return { text: `${days}d`, variant: "default" };
}

// =============================================================================
// Component
// =============================================================================

export default function InventoryDashboardPage() {
  const supabase = createClient();

  // Fetch low stock items
  // Note: This requires aggregating from inventory_lots since inventory_items is a catalog
  const { data: lowStockItems = [] } = useQuery({
    queryKey: ["dashboard", "low-stock"],
    queryFn: async () => {
      // Get items with reorder points
      const { data: items, error: itemsError } = await supabase
        .from("inventory_items")
        .select("id, name, category, reorder_point, unit")
        .not("reorder_point", "is", null)
        .order("name");

      if (itemsError) throw itemsError;

      // Get total quantities from inventory_lots
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { data: lotsData } = await db
        .from("inventory_lots_with_quantities")
        .select("item_id, remaining_quantity");

      // Aggregate by item_id
      const quantityByItem = new Map<string, number>();
      (lotsData || []).forEach((lot: { item_id: string; remaining_quantity: number }) => {
        const current = quantityByItem.get(lot.item_id) || 0;
        quantityByItem.set(lot.item_id, current + (lot.remaining_quantity || 0));
      });

      // Filter items below reorder point
      return (items || [])
        .filter((item) => {
          const currentQty = quantityByItem.get(item.id) || 0;
          return currentQty <= (item.reorder_point || 0);
        })
        .map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category || "other",
          current_qty: quantityByItem.get(item.id) || 0,
          reorder_point: item.reorder_point || 0,
          unit: item.unit || "units",
        })) as LowStockItem[];
    },
    refetchInterval: 60000, // Refresh every minute
  });

  // Fetch expiring lots (lots expiring within 90 days)
  const { data: expiringLots = [] } = useQuery({
    queryKey: ["dashboard", "expiring-lots"],
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
  });

  // Fetch inventory summary by category
  const { data: inventorySummary = [] } = useQuery({
    queryKey: ["dashboard", "inventory-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("category, id");

      if (error) throw error;

      // Group by category
      const categoryMap = new Map<string, number>();
      (data || []).forEach((item) => {
        const category = item.category || "other";
        categoryMap.set(category, (categoryMap.get(category) || 0) + 1);
      });

      return Array.from(categoryMap.entries()).map(([category, count]) => ({
        category,
        item_count: count,
        total_value: 0, // TODO: Calculate from inventory_lots
      })) as InventorySummary[];
    },
    refetchInterval: 60000,
  });

  // Calculate totals
  const lowStockCount = lowStockItems.length;
  const expiringCount = expiringLots.filter((lot) => lot.days_until_expiry <= 30).length;
  const totalItems = inventorySummary.reduce((sum, cat) => sum + cat.item_count, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Package className="h-6 w-6" />
          Inventory Dashboard
        </h1>
        <p className="text-muted-foreground">
          Inventory alerts and status overview
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock Alerts</CardTitle>
            <AlertTriangle className={`h-5 w-5 ${lowStockCount > 0 ? "text-amber-500" : "text-muted-foreground"}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{lowStockCount}</div>
            <p className="text-xs text-muted-foreground">
              items below reorder point
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Expiring Soon</CardTitle>
            <Calendar className={`h-5 w-5 ${expiringCount > 0 ? "text-red-500" : "text-muted-foreground"}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{expiringCount}</div>
            <p className="text-xs text-muted-foreground">
              lots expiring within 30 days
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Items</CardTitle>
            <Boxes className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalItems}</div>
            <p className="text-xs text-muted-foreground">
              inventory items tracked
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Low Stock Items */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <TrendingDown className="h-5 w-5 text-amber-500" />
                  Low Stock Items
                </CardTitle>
                <CardDescription>Items below reorder point</CardDescription>
              </div>
              <Link href="/inventory/items">
                <Button variant="outline" size="sm">
                  View All
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {lowStockItems.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>All items are stocked</p>
              </div>
            ) : (
              <div className="space-y-3">
                {lowStockItems.slice(0, 8).map((item) => {
                  const config = categoryConfig[item.category] || { icon: Package, color: "bg-slate-500" };
                  const Icon = config.icon;
                  const percentOfReorder = Math.round((item.current_qty / item.reorder_point) * 100);

                  return (
                    <Link
                      key={item.id}
                      href={`/inventory/items/${item.id}`}
                      className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-full ${config.color}`}>
                          <Icon className="h-4 w-4 text-white" />
                        </div>
                        <div>
                          <div className="font-medium">{item.name}</div>
                          <div className="text-sm text-muted-foreground">
                            Reorder at: {item.reorder_point} {item.unit}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-amber-600">
                          {item.current_qty} {item.unit}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {percentOfReorder}% of reorder
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Expiring Lots */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-red-500" />
                  Expiring Lots
                </CardTitle>
                <CardDescription>Lots approaching expiration</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {expiringLots.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No lots expiring soon</p>
              </div>
            ) : (
              <div className="space-y-3">
                {expiringLots.slice(0, 8).map((lot) => {
                  const expiryInfo = formatDaysUntilExpiry(lot.days_until_expiry);

                  return (
                    <div
                      key={lot.id}
                      className="flex items-center justify-between p-3 rounded-lg border"
                    >
                      <div>
                        <div className="font-medium">{lot.item_name}</div>
                        <div className="text-sm text-muted-foreground">
                          Lot: {lot.lot_number} • {lot.quantity} {lot.unit}
                        </div>
                      </div>
                      <Badge
                        variant={expiryInfo.variant === "warning" ? "secondary" : expiryInfo.variant}
                        className={expiryInfo.variant === "warning" ? "bg-amber-100 text-amber-800 hover:bg-amber-100" : ""}
                      >
                        {expiryInfo.text}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Inventory by Category */}
      <Card>
        <CardHeader>
          <CardTitle>Inventory by Category</CardTitle>
          <CardDescription>Item distribution across categories</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-5">
            {inventorySummary.map((summary) => {
              const config = categoryConfig[summary.category] || { icon: Package, color: "bg-slate-500" };
              const Icon = config.icon;

              return (
                <div
                  key={summary.category}
                  className="flex flex-col items-center p-4 rounded-lg border text-center"
                >
                  <div className={`p-3 rounded-full ${config.color} mb-2`}>
                    <Icon className="h-5 w-5 text-white" />
                  </div>
                  <div className="text-2xl font-bold">{summary.item_count}</div>
                  <div className="text-sm text-muted-foreground capitalize">
                    {summary.category}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* AI-Powered Inventory Overview */}
      <InventoryAlerts autoExpandOnAlerts={false} />
    </div>
  );
}
