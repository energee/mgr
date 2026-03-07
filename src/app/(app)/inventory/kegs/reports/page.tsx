"use client";

/**
 * Keg Reports Page
 *
 * Dashboard showing keg fleet metrics:
 * - Fleet summary by state
 * - Kegs out by customer
 * - Turnover metrics
 * - Aging kegs alerts
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { kegKeys } from "@/lib/query-keys";
import { dynamicFrom } from "@/services/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Package,
  Users,
  Clock,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";

// Types for report data
interface FleetSummary {
  selling_format_id: string;
  keg_type_name: string;
  volume_bbl: number;
  deposit_amount: number;
  empty_count: number;
  filled_count: number;
  shipped_count: number;
  dirty_count: number;
  cleaning_count: number;
  maintenance_count: number;
  retired_count: number;
  total_kegs: number;
  active_kegs: number;
  utilization_pct: number;
  deposits_outstanding: number;
}

interface TurnoverMetric {
  selling_format_id: string;
  keg_type_name: string;
  completed_cycles: number;
  avg_cycle_days: number;
  min_cycle_days: number;
  max_cycle_days: number;
  annual_turnover_rate: number;
}

interface AgingKeg {
  customer_id: string;
  customer_name: string;
  selling_format_id: string;
  keg_type_name: string;
  kegs_out: number;
  days_out: number;
  aging_status: "normal" | "attention" | "warning" | "critical";
  deposit_at_risk: number;
}

interface CustomerBalance {
  customer_id: string;
  customer_name: string;
  selling_format_id: string;
  keg_type_name: string;
  kegs_out: number;
  deposit_value: number;
}

const agingStatusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  normal: "default",
  attention: "secondary",
  warning: "outline",
  critical: "destructive",
};

export default function KegReportsPage() {
  const supabase = createClient();

  // Fetch fleet summary
  const { data: fleetSummary, isLoading: loadingFleet } = useQuery({
    queryKey: kegKeys.fleetSummary(),
    queryFn: async () => {
      const { data, error } = await dynamicFrom(supabase, "keg_fleet_summary")
        .select("*")
        .order("keg_type_name");
      if (error) throw error;
      return data as FleetSummary[];
    },
  });

  // Fetch turnover metrics
  const { data: turnoverMetrics, isLoading: loadingTurnover } = useQuery({
    queryKey: kegKeys.turnoverMetrics(),
    queryFn: async () => {
      const { data, error } = await dynamicFrom(supabase, "keg_turnover_metrics")
        .select("*")
        .order("keg_type_name");
      if (error) throw error;
      return data as TurnoverMetric[];
    },
  });

  // Fetch aging kegs (only non-normal)
  const { data: agingKegs, isLoading: loadingAging } = useQuery({
    queryKey: kegKeys.agingReport(),
    queryFn: async () => {
      const { data, error } = await dynamicFrom(supabase, "keg_aging_report")
        .select("*")
        .neq("aging_status", "normal")
        .order("days_out", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as AgingKeg[];
    },
  });

  // Fetch customer balances
  const { data: customerBalances, isLoading: loadingCustomers } = useQuery({
    queryKey: kegKeys.customerBalances(),
    queryFn: async () => {
      const { data, error } = await dynamicFrom(supabase, "customer_keg_balances")
        .select("*")
        .order("kegs_out", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as CustomerBalance[];
    },
  });

  // Calculate totals
  const totals = fleetSummary?.reduce(
    (acc, row) => ({
      totalKegs: acc.totalKegs + row.total_kegs,
      activeKegs: acc.activeKegs + row.active_kegs,
      shippedKegs: acc.shippedKegs + row.shipped_count,
      depositsOutstanding: acc.depositsOutstanding + row.deposits_outstanding,
    }),
    { totalKegs: 0, activeKegs: 0, shippedKegs: 0, depositsOutstanding: 0 }
  );

  const avgUtilization = fleetSummary?.length
    ? fleetSummary.reduce((sum, row) => sum + row.utilization_pct, 0) / fleetSummary.length
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/inventory/kegs">
            <Button variant="ghost" size="icon" aria-label="Back to kegs">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">
              Keg Reports
            </h1>
            <p className="text-muted-foreground">
              Fleet analytics, turnover metrics, and aging alerts
            </p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Fleet</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loadingFleet ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold">{totals?.totalKegs || 0}</div>
                <p className="text-xs text-muted-foreground">
                  {totals?.activeKegs || 0} active
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Out with Customers</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loadingFleet ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold">{totals?.shippedKegs || 0}</div>
                <p className="text-xs text-muted-foreground">kegs shipped</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Utilization</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loadingFleet ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold">{avgUtilization.toFixed(1)}%</div>
                <p className="text-xs text-muted-foreground">avg fleet utilization</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Deposits Outstanding</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loadingFleet ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  ${(totals?.depositsOutstanding || 0).toFixed(2)}
                </div>
                <p className="text-xs text-muted-foreground">with customers</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Two Column Layout */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Fleet Summary by Type */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Fleet Summary by Type
            </CardTitle>
            <CardDescription>Inventory counts by keg type and state</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingFleet ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : !fleetSummary?.length ? (
              <p className="text-center text-muted-foreground py-4">No keg data available</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Empty</TableHead>
                    <TableHead className="text-right">Filled</TableHead>
                    <TableHead className="text-right">Out</TableHead>
                    <TableHead className="text-right">Dirty</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fleetSummary.map((row) => (
                    <TableRow key={row.selling_format_id}>
                      <TableCell className="font-medium">{row.keg_type_name}</TableCell>
                      <TableCell className="text-right">{row.empty_count}</TableCell>
                      <TableCell className="text-right">{row.filled_count}</TableCell>
                      <TableCell className="text-right">{row.shipped_count}</TableCell>
                      <TableCell className="text-right">{row.dirty_count}</TableCell>
                      <TableCell className="text-right font-semibold">{row.total_kegs}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Turnover Metrics */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Turnover Metrics
            </CardTitle>
            <CardDescription>Average cycle time and annual turnover rate</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingTurnover ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : !turnoverMetrics?.length ? (
              <p className="text-center text-muted-foreground py-4">No turnover data yet</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Cycles</TableHead>
                    <TableHead className="text-right">Avg Days</TableHead>
                    <TableHead className="text-right">Turns/Yr</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {turnoverMetrics.map((row) => (
                    <TableRow key={row.selling_format_id}>
                      <TableCell className="font-medium">{row.keg_type_name}</TableCell>
                      <TableCell className="text-right">{row.completed_cycles}</TableCell>
                      <TableCell className="text-right">
                        {row.avg_cycle_days > 0 ? row.avg_cycle_days : "—"}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {row.annual_turnover_rate > 0 ? row.annual_turnover_rate : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Top Customers by Kegs Out */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Top Customers by Kegs Out
            </CardTitle>
            <CardDescription>Customers with most kegs in circulation</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingCustomers ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : !customerBalances?.length ? (
              <p className="text-center text-muted-foreground py-4">No kegs out</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Kegs</TableHead>
                    <TableHead className="text-right">Deposit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customerBalances.map((row, i) => (
                    <TableRow key={`${row.customer_id}-${row.selling_format_id}-${i}`}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/sales/customers/${row.customer_id}`}
                          className="hover:underline"
                        >
                          {row.customer_name}
                        </Link>
                      </TableCell>
                      <TableCell>{row.keg_type_name}</TableCell>
                      <TableCell className="text-right">{row.kegs_out}</TableCell>
                      <TableCell className="text-right">${row.deposit_value.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Aging Kegs Alert */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Aging Kegs
            </CardTitle>
            <CardDescription>Kegs out longer than 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingAging ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : !agingKegs?.length ? (
              <p className="text-center text-muted-foreground py-4">No aging kegs</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Days Out</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agingKegs.map((row, i) => (
                    <TableRow key={`${row.customer_id}-${row.selling_format_id}-${i}`}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/sales/customers/${row.customer_id}`}
                          className="hover:underline"
                        >
                          {row.customer_name}
                        </Link>
                      </TableCell>
                      <TableCell>{row.keg_type_name}</TableCell>
                      <TableCell className="text-right">{row.days_out}</TableCell>
                      <TableCell>
                        <Badge variant={agingStatusColors[row.aging_status]}>
                          {row.aging_status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
