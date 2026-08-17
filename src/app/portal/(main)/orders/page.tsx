"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { portalKeys } from "@/lib/query-keys";
import { usePortalCustomer } from "@/contexts/portal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/universal/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyStateHint } from "@/components/universal/empty-state-hint";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import Link from "next/link";
import { orderEntity } from "@/entities/order";
import { formatDate as sharedFormatDate } from "@/lib/format";
import { unwrap } from "@/lib/supabase/query-helpers";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  return sharedFormatDate(dateStr, { month: "short" });
}

export default function PortalOrdersPage() {
  const { customerIds } = usePortalCustomer();
  const supabase = createClient();

  const { data: orders, isLoading } = useQuery({
    queryKey: portalKeys.orders(customerIds),
    queryFn: async () => {
      return await unwrap(
        supabase
          .from("orders")
          .select(
            "id, order_number, status, order_date, requested_date, order_items(id)"
          )
          .order("order_date", { ascending: false })
      );
    },
    enabled: customerIds.length > 0,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
          <p className="text-muted-foreground">View and track your orders.</p>
        </div>
        <Button asChild>
          <Link href="/portal/orders/new">
            <Plus className="mr-2 h-4 w-4" />
            Place Order
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your Orders</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !orders || orders.length === 0 ? (
            <EmptyStateHint message="You don't have any orders yet. Place one with the button above, or your brewery can create one on your behalf." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Order Date</TableHead>
                  <TableHead>Requested Date</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <Link
                        href={`/portal/orders/${order.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {order.order_number}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={order.status}
                        config={orderEntity.stateMachine?.stateDisplay}
                      />
                    </TableCell>
                    <TableCell>{formatDate(order.order_date)}</TableCell>
                    <TableCell>{formatDate(order.requested_date)}</TableCell>
                    <TableCell className="text-right">
                      {order.order_items?.length ?? 0}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
