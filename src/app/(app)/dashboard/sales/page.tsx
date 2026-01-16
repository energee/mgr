"use client";

/**
 * Sales Dashboard
 *
 * Overview of sales metrics:
 * - Order pipeline (orders by status)
 * - Revenue by customer/channel
 * - Product mix analysis
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  ShoppingCart,
  DollarSign,
  Users,
  TrendingUp,
  ArrowRight,
  Clock,
  CheckCircle,
  Truck,
  Package,
  XCircle,
  FileText,
  Calendar,
  BarChart3,
} from "lucide-react";

// =============================================================================
// Types
// =============================================================================

interface OrderStatusCounts {
  draft: number;
  confirmed: number;
  scheduled: number;
  picking: number;
  packed: number;
  fulfilled: number;
  cancelled: number;
}

interface RecentOrder {
  id: string;
  order_number: string;
  status: string;
  order_date: string;
  customer_name?: string;
  total_value: number;
}

interface CustomerRevenue {
  customer_id: string;
  customer_name: string;
  order_count: number;
  total_revenue: number;
  sales_channel?: string;
}

interface ProductMix {
  brand_id: string;
  brand_name: string;
  total_quantity: number;
  total_revenue: number;
}

// =============================================================================
// Status Configuration
// =============================================================================

const statusConfig = {
  draft: { label: "Draft", icon: FileText, color: "bg-slate-500" },
  confirmed: { label: "Confirmed", icon: CheckCircle, color: "bg-blue-500" },
  scheduled: { label: "Scheduled", icon: Calendar, color: "bg-cyan-500" },
  picking: { label: "Picking", icon: Package, color: "bg-amber-500" },
  packed: { label: "Packed", icon: Package, color: "bg-orange-500" },
  fulfilled: { label: "Fulfilled", icon: Truck, color: "bg-green-500" },
  cancelled: { label: "Cancelled", icon: XCircle, color: "bg-red-500" },
};

const badgeVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  confirmed: "secondary",
  scheduled: "secondary",
  picking: "default",
  packed: "default",
  fulfilled: "default",
  cancelled: "destructive",
};

// =============================================================================
// Helper Functions
// =============================================================================

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// =============================================================================
// Component
// =============================================================================

export default function SalesDashboardPage() {
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Fetch order status counts
  const { data: orderCounts = { draft: 0, confirmed: 0, scheduled: 0, picking: 0, packed: 0, fulfilled: 0, cancelled: 0 } } = useQuery({
    queryKey: ["dashboard", "sales", "order-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("status");

      if (error) throw error;

      const counts: OrderStatusCounts = {
        draft: 0,
        confirmed: 0,
        scheduled: 0,
        picking: 0,
        packed: 0,
        fulfilled: 0,
        cancelled: 0,
      };

      data?.forEach((order) => {
        const status = order.status as keyof OrderStatusCounts;
        if (counts[status] !== undefined) {
          counts[status]++;
        }
      });

      return counts;
    },
    refetchInterval: 30000,
  });

  // Fetch recent orders with totals
  const { data: recentOrders = [] } = useQuery({
    queryKey: ["dashboard", "sales", "recent-orders"],
    queryFn: async () => {
      // Get recent orders
      const { data: orders, error: ordersError } = await supabase
        .from("orders")
        .select(`
          id,
          order_number,
          status,
          order_date,
          customers:customer_id(name)
        `)
        .not("status", "eq", "cancelled")
        .order("order_date", { ascending: false })
        .limit(10);

      if (ordersError) throw ordersError;

      // Get order items for value calculation
      const { data: items } = await supabase
        .from("order_items")
        .select("order_id, quantity, unit_price");

      // Calculate totals per order
      const orderTotals = new Map<string, number>();
      (items || []).forEach((item) => {
        const current = orderTotals.get(item.order_id) || 0;
        const lineTotal = (item.quantity || 0) * (item.unit_price || 0);
        orderTotals.set(item.order_id, current + lineTotal);
      });

      return (orders || []).map((order) => ({
        id: order.id,
        order_number: order.order_number,
        status: order.status,
        order_date: order.order_date,
        customer_name: (order.customers as { name: string } | null)?.name || "Walk-in",
        total_value: orderTotals.get(order.id) || 0,
      })) as RecentOrder[];
    },
    refetchInterval: 30000,
  });

  // Fetch revenue by customer (top 10)
  const { data: customerRevenue = [] } = useQuery({
    queryKey: ["dashboard", "sales", "customer-revenue"],
    queryFn: async () => {
      // Get fulfilled orders with customer info
      const { data: orders, error: ordersError } = await supabase
        .from("orders")
        .select(`
          id,
          customer_id,
          customers:customer_id(name, sales_channel_id)
        `)
        .eq("status", "fulfilled");

      if (ordersError) throw ordersError;

      // Get order items
      const { data: items } = await supabase
        .from("order_items")
        .select("order_id, quantity, unit_price");

      // Calculate revenue per order
      const orderTotals = new Map<string, number>();
      (items || []).forEach((item) => {
        const current = orderTotals.get(item.order_id) || 0;
        const lineTotal = (item.quantity || 0) * (item.unit_price || 0);
        orderTotals.set(item.order_id, current + lineTotal);
      });

      // Get sales channel names
      const { data: channels } = await db
        .from("sales_channels")
        .select("id, name");

      const channelMap = new Map<string, string>();
      (channels || []).forEach((ch: { id: string; name: string }) => {
        channelMap.set(ch.id, ch.name);
      });

      // Aggregate by customer
      const customerMap = new Map<string, { name: string; channel?: string; orders: number; revenue: number }>();
      (orders || []).forEach((order) => {
        const customerId = order.customer_id || "walk-in";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const customerInfo = order.customers as any;
        const current = customerMap.get(customerId) || {
          name: customerInfo?.name || "Walk-in",
          channel: customerInfo?.sales_channel_id ? channelMap.get(customerInfo.sales_channel_id) : undefined,
          orders: 0,
          revenue: 0,
        };
        current.orders += 1;
        current.revenue += orderTotals.get(order.id) || 0;
        customerMap.set(customerId, current);
      });

      // Sort by revenue and return top 10
      return Array.from(customerMap.entries())
        .map(([id, data]) => ({
          customer_id: id,
          customer_name: data.name,
          order_count: data.orders,
          total_revenue: data.revenue,
          sales_channel: data.channel,
        }))
        .sort((a, b) => b.total_revenue - a.total_revenue)
        .slice(0, 10) as CustomerRevenue[];
    },
    refetchInterval: 60000,
  });

  // Fetch product mix (revenue by brand)
  const { data: productMix = [] } = useQuery({
    queryKey: ["dashboard", "sales", "product-mix"],
    queryFn: async () => {
      // Get fulfilled order IDs
      const { data: fulfilledOrders, error: ordersError } = await supabase
        .from("orders")
        .select("id")
        .eq("status", "fulfilled");

      if (ordersError) throw ordersError;

      const fulfilledIds = (fulfilledOrders || []).map((o) => o.id);
      if (fulfilledIds.length === 0) return [];

      // Get order items with brand info
      const { data: items, error: itemsError } = await supabase
        .from("order_items")
        .select(`
          brand_id,
          quantity,
          unit_price,
          brands:brand_id(name)
        `)
        .in("order_id", fulfilledIds);

      if (itemsError) throw itemsError;

      // Aggregate by brand
      const brandMap = new Map<string, { name: string; quantity: number; revenue: number }>();
      (items || []).forEach((item) => {
        const brandId = item.brand_id || "other";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const brandInfo = item.brands as any;
        const current = brandMap.get(brandId) || {
          name: brandInfo?.name || "Other",
          quantity: 0,
          revenue: 0,
        };
        current.quantity += item.quantity || 0;
        current.revenue += (item.quantity || 0) * (item.unit_price || 0);
        brandMap.set(brandId, current);
      });

      // Sort by revenue
      return Array.from(brandMap.entries())
        .map(([id, data]) => ({
          brand_id: id,
          brand_name: data.name,
          total_quantity: data.quantity,
          total_revenue: data.revenue,
        }))
        .sort((a, b) => b.total_revenue - a.total_revenue)
        .slice(0, 10) as ProductMix[];
    },
    refetchInterval: 60000,
  });

  // Calculate summary stats
  const activeOrders = orderCounts.confirmed + orderCounts.scheduled + orderCounts.picking + orderCounts.packed;
  const totalRevenue = customerRevenue.reduce((sum, c) => sum + c.total_revenue, 0);
  const avgOrderValue = recentOrders.length > 0
    ? recentOrders.reduce((sum, o) => sum + o.total_value, 0) / recentOrders.filter(o => o.total_value > 0).length
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <TrendingUp className="h-6 w-6" />
          Sales Dashboard
        </h1>
        <p className="text-muted-foreground">
          Order pipeline and revenue overview
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Orders</CardTitle>
            <ShoppingCart className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeOrders}</div>
            <p className="text-xs text-muted-foreground">
              in pipeline
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Draft Orders</CardTitle>
            <Clock className="h-5 w-5 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{orderCounts.draft}</div>
            <p className="text-xs text-muted-foreground">
              awaiting confirmation
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-5 w-5 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalRevenue)}</div>
            <p className="text-xs text-muted-foreground">
              from fulfilled orders
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Order Value</CardTitle>
            <BarChart3 className="h-5 w-5 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {avgOrderValue > 0 ? formatCurrency(avgOrderValue) : "—"}
            </div>
            <p className="text-xs text-muted-foreground">
              recent orders
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Order Pipeline */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Order Pipeline</CardTitle>
              <CardDescription>Orders by status across the fulfillment workflow</CardDescription>
            </div>
            <Link href="/sales/orders">
              <Button variant="outline" size="sm">
                View All Orders
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-7">
            {Object.entries(statusConfig).map(([status, config]) => {
              const Icon = config.icon;
              const count = orderCounts[status as keyof OrderStatusCounts] || 0;

              return (
                <Link
                  key={status}
                  href={`/sales/orders?status=${status}`}
                  className="flex flex-col items-center p-4 rounded-lg border hover:bg-muted/50 transition-colors text-center"
                >
                  <div className={`p-2 rounded-full ${config.color} mb-2`}>
                    <Icon className="h-4 w-4 text-white" />
                  </div>
                  <div className="text-2xl font-bold">{count}</div>
                  <div className="text-xs text-muted-foreground">{config.label}</div>
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Recent Orders */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Recent Orders</CardTitle>
                <CardDescription>Latest orders by date</CardDescription>
              </div>
              <Link href="/sales/orders">
                <Button variant="outline" size="sm">
                  View All
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {recentOrders.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <ShoppingCart className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No orders yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentOrders.slice(0, 6).map((order) => (
                  <Link
                    key={order.id}
                    href={`/sales/orders/${order.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{order.order_number}</div>
                      <div className="text-sm text-muted-foreground truncate">
                        {order.customer_name}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {order.total_value > 0 && (
                        <span className="text-sm font-medium">
                          {formatCurrency(order.total_value)}
                        </span>
                      )}
                      <Badge variant={badgeVariants[order.status] || "default"}>
                        {statusConfig[order.status as keyof typeof statusConfig]?.label || order.status}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Customers */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Top Customers
                </CardTitle>
                <CardDescription>By fulfilled order revenue</CardDescription>
              </div>
              <Link href="/sales/customers">
                <Button variant="outline" size="sm">
                  View All
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {customerRevenue.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No fulfilled orders yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {customerRevenue.slice(0, 6).map((customer, index) => (
                  <div
                    key={customer.customer_id}
                    className="flex items-center justify-between p-3 rounded-lg border"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-bold">
                        {index + 1}
                      </div>
                      <div>
                        <div className="font-medium">{customer.customer_name}</div>
                        <div className="text-sm text-muted-foreground">
                          {customer.order_count} orders
                          {customer.sales_channel && ` • ${customer.sales_channel}`}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-green-600">
                        {formatCurrency(customer.total_revenue)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Product Mix */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Product Mix
          </CardTitle>
          <CardDescription>Revenue breakdown by brand</CardDescription>
        </CardHeader>
        <CardContent>
          {productMix.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No product sales data yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              {productMix.map((product) => {
                const maxRevenue = Math.max(...productMix.map(p => p.total_revenue));
                const percentage = maxRevenue > 0 ? (product.total_revenue / maxRevenue) * 100 : 0;

                return (
                  <div key={product.brand_id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{product.brand_name}</div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-muted-foreground">
                          {product.total_quantity.toLocaleString()} units
                        </span>
                        <span className="font-bold text-green-600">
                          {formatCurrency(product.total_revenue)}
                        </span>
                      </div>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-500"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
