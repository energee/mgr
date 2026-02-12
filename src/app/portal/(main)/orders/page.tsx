"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { portalKeys } from "@/lib/query-keys";
import { usePortalCustomer } from "@/lib/portal-context";
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
import Link from "next/link";
import { orderEntity } from "@/entities/order";

function formatDate(dateString: string | null): string {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function PortalOrdersPage() {
  const { customerIds } = usePortalCustomer();
  const supabase = createClient();

  const { data: orders, isLoading } = useQuery({
    queryKey: portalKeys.orders(customerIds),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, order_number, status, order_date, requested_date, order_items(id)"
        )
        .order("order_date", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: customerIds.length > 0,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
        <p className="text-muted-foreground">View and track your orders.</p>
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
            <div className="py-12 text-center text-muted-foreground">
              No orders found.
            </div>
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
