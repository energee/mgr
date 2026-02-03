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
import { dashboardKeys } from "@/lib/query-keys";
import Link from "next/link";
import { orderEntity } from "@/entities/order";
import { StatusBadge } from "@/components/universal/status-badge";
import { StatsStrip, DashboardSection, DashboardEmpty } from "@/components/dashboard";
import type { StatItem } from "@/components/dashboard";

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
// Constants
// =============================================================================

const MAX_ORDERS_SHOWN = 6;
const MAX_CUSTOMERS_SHOWN = 6;
const MAX_QUERY_RESULTS = 10;

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
    queryKey: dashboardKeys.sales.orderCounts(),
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
    queryKey: dashboardKeys.sales.recentOrders(),
    queryFn: async () => {
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

      const { data: items } = await supabase
        .from("order_items")
        .select("order_id, quantity, unit_price");

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
    queryKey: dashboardKeys.sales.customerRevenue(),
    queryFn: async () => {
      const { data: orders, error: ordersError } = await supabase
        .from("orders")
        .select(`
          id,
          customer_id,
          customers:customer_id(name, sales_channel_id)
        `)
        .eq("status", "fulfilled");

      if (ordersError) throw ordersError;

      const { data: items } = await supabase
        .from("order_items")
        .select("order_id, quantity, unit_price");

      const orderTotals = new Map<string, number>();
      (items || []).forEach((item) => {
        const current = orderTotals.get(item.order_id) || 0;
        const lineTotal = (item.quantity || 0) * (item.unit_price || 0);
        orderTotals.set(item.order_id, current + lineTotal);
      });

      const { data: channels } = await db
        .from("sales_channels")
        .select("id, name");

      const channelMap = new Map<string, string>();
      (channels || []).forEach((ch: { id: string; name: string }) => {
        channelMap.set(ch.id, ch.name);
      });

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

      return Array.from(customerMap.entries())
        .map(([id, data]) => ({
          customer_id: id,
          customer_name: data.name,
          order_count: data.orders,
          total_revenue: data.revenue,
          sales_channel: data.channel,
        }))
        .sort((a, b) => b.total_revenue - a.total_revenue)
        .slice(0, MAX_QUERY_RESULTS) as CustomerRevenue[];
    },
    refetchInterval: 60000,
  });

  // Fetch product mix (revenue by brand)
  const { data: productMix = [] } = useQuery({
    queryKey: dashboardKeys.sales.productMix(),
    queryFn: async () => {
      const { data: fulfilledOrders, error: ordersError } = await supabase
        .from("orders")
        .select("id")
        .eq("status", "fulfilled");

      if (ordersError) throw ordersError;

      const fulfilledIds = (fulfilledOrders || []).map((o) => o.id);
      if (fulfilledIds.length === 0) return [];

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

      return Array.from(brandMap.entries())
        .map(([id, data]) => ({
          brand_id: id,
          brand_name: data.name,
          total_quantity: data.quantity,
          total_revenue: data.revenue,
        }))
        .sort((a, b) => b.total_revenue - a.total_revenue)
        .slice(0, MAX_QUERY_RESULTS) as ProductMix[];
    },
    refetchInterval: 60000,
  });

  // Calculate summary stats
  const activeOrders = orderCounts.confirmed + orderCounts.scheduled + orderCounts.picking + orderCounts.packed;
  const totalRevenue = customerRevenue.reduce((sum, c) => sum + c.total_revenue, 0);
  const avgOrderValue = recentOrders.length > 0
    ? recentOrders.reduce((sum, o) => sum + o.total_value, 0) / recentOrders.filter(o => o.total_value > 0).length
    : 0;

  // Build stats for the strip
  const primaryStats: StatItem[] = [
    { value: activeOrders, label: "active orders" },
    { value: orderCounts.draft, label: "draft" },
    { value: formatCurrency(totalRevenue), label: "revenue" },
    { value: avgOrderValue > 0 ? formatCurrency(avgOrderValue) : "—", label: "avg order" },
  ];

  const secondaryStats: StatItem[] = [
    { value: orderCounts.fulfilled, label: "fulfilled" },
  ];

  if (orderCounts.cancelled > 0) {
    secondaryStats.push({ value: orderCounts.cancelled, label: "cancelled" });
  }

  // Pipeline statuses for flow display
  const pipelineStatuses = [
    { key: "draft", label: "Draft", count: orderCounts.draft },
    { key: "confirmed", label: "Confirmed", count: orderCounts.confirmed },
    { key: "scheduled", label: "Scheduled", count: orderCounts.scheduled },
    { key: "picking", label: "Picking", count: orderCounts.picking },
    { key: "packed", label: "Packed", count: orderCounts.packed },
    { key: "fulfilled", label: "Fulfilled", count: orderCounts.fulfilled },
  ];

  return (
    <div className="space-y-6">
      {/* Header with Stats Strip */}
      <div className="space-y-1">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold">Sales Dashboard</h1>
          <Link
            href="/sales/orders"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            View All Orders
          </Link>
        </div>
        <StatsStrip stats={primaryStats} secondaryStats={secondaryStats} />
      </div>

      {/* Order Pipeline */}
      <DashboardSection title="Order Pipeline" viewAllHref="/sales/orders">
        <div className="flex gap-2">
          {pipelineStatuses.map((status, index) => (
            <Link
              key={status.key}
              href={`/sales/orders?status=${status.key}`}
              className="flex-1 flex flex-col items-center p-3 rounded-lg border hover:bg-muted/50 transition-colors text-center relative"
            >
              <span className="font-mono text-2xl font-semibold">{status.count}</span>
              <span className="text-xs text-muted-foreground">{status.label}</span>
              {index < pipelineStatuses.length - 1 && (
                <span className="absolute -right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 z-10">
                  →
                </span>
              )}
            </Link>
          ))}
        </div>
      </DashboardSection>

      {/* Two-Column Layout */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Recent Orders */}
        <DashboardSection title="Recent Orders" viewAllHref="/sales/orders">
          {recentOrders.length === 0 ? (
            <DashboardEmpty message="No orders yet" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 font-medium uppercase tracking-wider text-xs text-muted-foreground">Order</th>
                  <th className="pb-2 font-medium uppercase tracking-wider text-xs text-muted-foreground">Customer</th>
                  <th className="pb-2 font-medium uppercase tracking-wider text-xs text-muted-foreground text-right">Value</th>
                  <th className="pb-2 font-medium uppercase tracking-wider text-xs text-muted-foreground text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recentOrders.slice(0, MAX_ORDERS_SHOWN).map((order) => (
                  <tr key={order.id} className="hover:bg-muted/50">
                    <td className="py-2">
                      <Link href={`/sales/orders/${order.id}`} className="hover:underline">
                        <span className="font-mono font-medium">{order.order_number}</span>
                      </Link>
                    </td>
                    <td className="py-2 text-muted-foreground truncate max-w-[150px]">
                      {order.customer_name}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {order.total_value > 0 ? formatCurrency(order.total_value) : "—"}
                    </td>
                    <td className="py-2 text-right">
                      <StatusBadge
                        status={order.status}
                        config={orderEntity.stateMachine?.stateDisplay}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DashboardSection>

        {/* Top Customers */}
        <DashboardSection title="Top Customers" viewAllHref="/sales/customers">
          {customerRevenue.length === 0 ? (
            <DashboardEmpty message="No fulfilled orders yet" />
          ) : (
            <div className="divide-y">
              {customerRevenue.slice(0, MAX_CUSTOMERS_SHOWN).map((customer, index) => (
                <div
                  key={customer.customer_id}
                  className="flex items-center justify-between py-2"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {index + 1}
                    </span>
                    <div>
                      <div className="font-medium text-sm">{customer.customer_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {customer.order_count} orders
                        {customer.sales_channel && ` · ${customer.sales_channel}`}
                      </div>
                    </div>
                  </div>
                  <span className="font-mono font-semibold text-emerald-600">
                    {formatCurrency(customer.total_revenue)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </DashboardSection>
      </div>

      {/* Product Mix */}
      <DashboardSection title="Product Mix">
        {productMix.length === 0 ? (
          <DashboardEmpty message="No product sales data yet" />
        ) : (
          <div className="space-y-3">
            {productMix.map((product) => {
              const maxRevenue = Math.max(...productMix.map(p => p.total_revenue));
              const percentage = maxRevenue > 0 ? (product.total_revenue / maxRevenue) * 100 : 0;

              return (
                <div key={product.brand_id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{product.brand_name}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-muted-foreground font-mono">
                        {product.total_quantity.toLocaleString()} units
                      </span>
                      <span className="font-mono font-semibold text-emerald-600">
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
      </DashboardSection>
    </div>
  );
}
