"use client";

/**
 * Dashboard Page
 *
 * Overview of brewery operations.
 * Shows key metrics and quick actions.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Beaker, Package, ShoppingCart, AlertTriangle, Plus, ArrowRight } from "lucide-react";

export default function DashboardPage() {
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Fetch batch stats
  const { data: batchStats, isLoading: batchLoading } = useQuery({
    queryKey: ["dashboard", "batches"],
    queryFn: async () => {
      const { data, error } = await db
        .from("batches")
        .select("id, status")
        .in("status", ["planned", "brewing", "fermenting", "conditioning"]);
      if (error) throw error;
      return {
        total: data?.length || 0,
        brewing: data?.filter((b: { status: string }) => b.status === "brewing").length || 0,
        fermenting: data?.filter((b: { status: string }) => b.status === "fermenting").length || 0,
      };
    },
  });

  // Fetch order stats
  const { data: orderStats, isLoading: orderLoading } = useQuery({
    queryKey: ["dashboard", "orders"],
    queryFn: async () => {
      const { data, error } = await db
        .from("orders")
        .select("id, status")
        .in("status", ["pending", "confirmed", "picking"]);
      if (error) return { pending: 0 };
      return {
        pending: data?.length || 0,
      };
    },
  });

  // Fetch recent batches for quick access
  const { data: recentBatches, isLoading: recentLoading } = useQuery({
    queryKey: ["dashboard", "recent-batches"],
    queryFn: async () => {
      const { data, error } = await db
        .from("batches")
        .select("id, batch_number, name, status, brew_date")
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data || [];
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Overview of your brewery operations</p>
        </div>
        <Button asChild>
          <Link href="/production/batches/new">
            <Plus className="h-4 w-4 mr-2" />
            New Batch
          </Link>
        </Button>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Active Batches</CardTitle>
            <Beaker className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {batchLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold">{batchStats?.total || 0}</div>
                <p className="text-xs text-muted-foreground">
                  {batchStats?.brewing || 0} brewing, {batchStats?.fermenting || 0} fermenting
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Pending Orders</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {orderLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold">{orderStats?.pending || 0}</div>
                <p className="text-xs text-muted-foreground">Awaiting fulfillment</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Packaging Today</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">—</div>
            <p className="text-xs text-muted-foreground">No scheduled packaging</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Low Inventory</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">—</div>
            <p className="text-xs text-muted-foreground">No alerts</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Batches */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent Batches</CardTitle>
            <CardDescription>Your most recent production batches</CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/production/batches">
              View all
              <ArrowRight className="h-4 w-4 ml-1" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {recentLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : recentBatches && recentBatches.length > 0 ? (
            <div className="space-y-2">
              {recentBatches.map((batch: { id: string; batch_number: string; name: string; status: string; brew_date: string | null }) => (
                <Link
                  key={batch.id}
                  href={`/production/batches/${batch.id}`}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div>
                    <p className="font-medium">{batch.batch_number}</p>
                    <p className="text-sm text-muted-foreground">{batch.name}</p>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium bg-muted">
                      {batch.status}
                    </span>
                    {batch.brew_date && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(batch.brew_date).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Beaker className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No batches yet</p>
              <Button variant="link" asChild className="mt-2">
                <Link href="/production/batches/new">Create your first batch</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
