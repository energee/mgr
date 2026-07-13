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
import { Suspense } from "react";
import { ShoppingCart, Users, BarChart3 } from "lucide-react";
import { StatsStrip, DashboardSection, DashboardEmpty, PeriodSelector, usePeriod, StatCardWithDelta, calculateDelta, TrendChartLazy } from "@/components/dashboard";
import type { StatItem } from "@/components/dashboard";
import { CACHE_DURATIONS, POLLING_INTERVALS } from "@/lib/constants";
import { dynamicFrom, dynamicRpc } from "@/services/types";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency as formatCurrencyBase } from "@/lib/format";
import { log } from "@/lib/client-logger";
import { unwrap } from "@/lib/supabase/query-helpers";

/** Sales dashboard uses whole-dollar formatting for cleaner high-level display. */
const formatCurrency = (v: number | null | undefined) => formatCurrencyBase(v, 0);

// =============================================================================
// Types
// =============================================================================

type OrderStatusCounts = {
  draft: number;
  confirmed: number;
  scheduled: number;
  picking: number;
  packed: number;
  fulfilled: number;
  cancelled: number;
}

type RecentOrder = {
  id: string;
  order_number: string;
  status: string;
  order_date: string;
  customer_name?: string;
  total_value: number;
}

type CustomerRevenue = {
  customer_id: string;
  customer_name: string;
  order_count: number;
  total_revenue: number;
  sales_channel?: string;
}

type ProductMix = {
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

const DEFAULT_ORDER_COUNTS: OrderStatusCounts = {
  draft: 0,
  confirmed: 0,
  scheduled: 0,
  picking: 0,
  packed: 0,
  fulfilled: 0,
  cancelled: 0,
};

// =============================================================================
// Sub-Components
// =============================================================================

function ProductMixBars({ products }: { products: ProductMix[] }) {
  const maxRevenue = Math.max(...products.map((p) => p.total_revenue));

  return (
    <div className="space-y-3">
      {products.map((product) => {
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
  );
}

// =============================================================================
// Component
// =============================================================================

export default function SalesDashboardPage() {
  const supabase = createClient();

  const { data: orderCounts = DEFAULT_ORDER_COUNTS } = useQuery({
    queryKey: dashboardKeys.sales.orderCounts(),
    queryFn: async () => {
      const data = await unwrap(
        dynamicFrom(supabase, "order_status_counts").select("status, count")
      ) as unknown as Array<{ status: string; count: number }>;

      const counts = { ...DEFAULT_ORDER_COUNTS };
      for (const row of data ?? []) {
        const status = row.status as keyof OrderStatusCounts;
        if (status in counts) {
          counts[status] = row.count;
        }
      }

      return counts;
    },
    refetchInterval: POLLING_INTERVALS.FAST,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
  });

  // Fetch recent orders with totals (uses order_totals view via join)
  const { data: recentOrders = [] } = useQuery({
    queryKey: dashboardKeys.sales.recentOrders(),
    queryFn: async () => {
      const orders = await unwrap(
        supabase
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
          .limit(10)
      );

      // Fetch pre-aggregated totals only for displayed orders
      const orderIds = (orders || []).map((o) => o.id);
      let totals: { order_id: string; total_value: number }[] = [];
      if (orderIds.length > 0) {
        totals = await unwrap(
          dynamicFrom(supabase, "order_totals")
            .select("order_id, total_value")
            .in("order_id", orderIds)
        ) as unknown as { order_id: string; total_value: number }[];
      }

      const totalMap = new Map<string, number>();
      for (const t of totals ?? []) {
        totalMap.set(t.order_id, t.total_value);
      }

      return (orders || []).map((order) => ({
        id: order.id,
        order_number: order.order_number,
        status: order.status,
        order_date: order.order_date,
        customer_name: (order.customers as { name: string } | null)?.name || "Walk-in",
        total_value: totalMap.get(order.id) || 0,
      })) as RecentOrder[];
    },
    refetchInterval: POLLING_INTERVALS.FAST,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
  });

  // Fetch revenue by customer (pre-aggregated view, top 10)
  const { data: customerRevenue = [] } = useQuery({
    queryKey: dashboardKeys.sales.customerRevenue(),
    queryFn: async () => {
      return await unwrap(
        dynamicFrom(supabase, "customer_revenue_summary")
          .select("customer_id, customer_name, sales_channel, order_count, total_revenue")
          .order("total_revenue", { ascending: false })
          .limit(MAX_QUERY_RESULTS)
      ) as unknown as CustomerRevenue[];
    },
    refetchInterval: POLLING_INTERVALS.NORMAL,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
  });

  // Fetch product mix (pre-aggregated view, revenue by brand)
  const { data: productMix = [] } = useQuery({
    queryKey: dashboardKeys.sales.productMix(),
    queryFn: async () => {
      return await unwrap(
        dynamicFrom(supabase, "product_mix_by_brand")
          .select("brand_id, brand_name, total_quantity, total_revenue")
          .order("total_revenue", { ascending: false })
          .limit(MAX_QUERY_RESULTS)
      ) as unknown as ProductMix[];
    },
    refetchInterval: POLLING_INTERVALS.NORMAL,
    refetchIntervalInBackground: false,
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
  });

  // Calculate summary stats
  const activeOrders = orderCounts.confirmed + orderCounts.scheduled + orderCounts.picking + orderCounts.packed;
  const totalRevenue = customerRevenue.reduce((sum, c) => sum + c.total_revenue, 0);
  const ordersWithValue = recentOrders.filter((o) => o.total_value > 0);
  const avgOrderValue = ordersWithValue.length > 0
    ? ordersWithValue.reduce((sum, o) => sum + o.total_value, 0) / ordersWithValue.length
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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <h1 className="text-2xl font-semibold">Sales Dashboard</h1>
          <div className="flex items-center gap-4">
            <Suspense fallback={null}>
              <PeriodSelector />
            </Suspense>
            <Link
              href="/sales/orders"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              View All Orders
            </Link>
          </div>
        </div>
        <StatsStrip stats={primaryStats} secondaryStats={secondaryStats} />
      </div>

      {/* Order Pipeline */}
      <DashboardSection title="Order Pipeline" viewAllHref="/sales/orders">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {pipelineStatuses.map((status, index) => (
            <Link
              key={status.key}
              href={`/sales/orders?status=${status.key}`}
              className="flex-1 min-w-[80px] flex flex-col items-center p-3 rounded-lg border hover:bg-muted/50 transition-colors text-center relative"
            >
              <span className="font-mono text-2xl font-semibold">{status.count}</span>
              <span className="text-xs text-muted-foreground">{status.label}</span>
              {index < pipelineStatuses.length - 1 && (
                <span className="absolute -right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 z-10 hidden lg:block">
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
            <DashboardEmpty
              message="No orders yet"
              icon={ShoppingCart}
              action={{ label: "Create an order", href: "/sales/orders/new" }}
            />
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
            <DashboardEmpty message="No fulfilled orders yet" icon={Users} />
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
          <DashboardEmpty message="No product sales data yet" icon={BarChart3} />
        ) : (
          <ProductMixBars products={productMix} />
        )}
      </DashboardSection>

      {/* Period Trends (wrapped in Suspense for useSearchParams) */}
      <Suspense fallback={<SalesTrendsSkeleton />}>
        <SalesTrends />
      </Suspense>
    </div>
  );
}

// =============================================================================
// Sales Trends (Suspense child — uses useSearchParams via usePeriod)
// =============================================================================

function SalesTrendsSkeleton() {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px] rounded-lg" />
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-[248px] rounded-lg" />
        ))}
      </div>
    </>
  );
}

function SalesTrends() {
  const supabase = createClient();
  const period = usePeriod();

  const { data: salesTrends = [], isLoading } = useQuery({
    queryKey: dashboardKeys.trends.sales(period),
    queryFn: async () => {
      const { data, error } = await dynamicRpc(supabase, "get_sales_trends", {
        p_days: period,
      });
      if (error) {
        log.error("Failed to fetch sales trends:", error);
        return [];
      }
      return (data || []) as Array<{
        date: string;
        order_count: number;
        revenue: number;
        fulfilled_count: number;
      }>;
    },
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });

  if (isLoading) {
    return <SalesTrendsSkeleton />;
  }

  const currentPeriodData = salesTrends.slice(period);
  const previousPeriodData = salesTrends.slice(0, period);

  const currentRevenue = currentPeriodData.reduce((sum, d) => sum + Number(d.revenue), 0);
  const previousRevenue = previousPeriodData.reduce((sum, d) => sum + Number(d.revenue), 0);

  const currentOrderCount = currentPeriodData.reduce((sum, d) => sum + d.order_count, 0);
  const previousOrderCount = previousPeriodData.reduce((sum, d) => sum + d.order_count, 0);

  const currentAvgOrder = currentOrderCount > 0 ? currentRevenue / currentOrderCount : 0;
  const previousAvgOrder = previousOrderCount > 0 ? previousRevenue / previousOrderCount : 0;

  const deltaLabel = `vs prev ${period}d`;

  return (
    <>
      {/* Period Comparison Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCardWithDelta
          value={formatCurrency(currentRevenue)}
          label="revenue"
          delta={calculateDelta(currentRevenue, previousRevenue)}
          deltaLabel={deltaLabel}
        />
        <StatCardWithDelta
          value={currentOrderCount}
          label="orders placed"
          delta={calculateDelta(currentOrderCount, previousOrderCount)}
          deltaLabel={deltaLabel}
        />
        <StatCardWithDelta
          value={currentAvgOrder > 0 ? formatCurrency(currentAvgOrder) : "—"}
          label="avg order value"
          delta={calculateDelta(currentAvgOrder, previousAvgOrder)}
          deltaLabel={deltaLabel}
        />
      </div>

      {/* Trend Charts */}
      <div className="grid gap-6 md:grid-cols-2">
        <DashboardSection title="Revenue">
          <Suspense fallback={<Skeleton className="h-[200px] w-full" />}>
            <TrendChartLazy
              data={currentPeriodData}
              xKey="date"
              type="bar"
              series={[{ key: "revenue", label: "Revenue" }]}
              formatValue={(v) => formatCurrency(v)}
            />
          </Suspense>
        </DashboardSection>
        <DashboardSection title="Orders">
          <Suspense fallback={<Skeleton className="h-[200px] w-full" />}>
            <TrendChartLazy
              data={currentPeriodData}
              xKey="date"
              series={[{ key: "order_count", label: "Orders" }]}
            />
          </Suspense>
        </DashboardSection>
      </div>
    </>
  );
}
