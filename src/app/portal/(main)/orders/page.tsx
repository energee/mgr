"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { entityKeys } from "@/lib/query-keys";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { format } from "date-fns";

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  confirmed: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  picking:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  packed:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  fulfilled:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const statusLabels: Record<string, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  scheduled: "Scheduled",
  picking: "Picking",
  packed: "Packed",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
};

function formatDate(dateString: string | null): string {
  if (!dateString) return "-";
  return format(new Date(dateString), "MMM d, yyyy");
}

export default function PortalOrdersPage() {
  const { customerId } = usePortalCustomer();
  const supabase = createClient();

  const { data: orders, isLoading } = useQuery({
    queryKey: entityKeys.list("orders"),
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
    enabled: !!customerId,
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
                      <Badge
                        variant="outline"
                        className={
                          statusColors[order.status ?? ""] ?? statusColors.draft
                        }
                      >
                        {statusLabels[order.status ?? ""] ??
                          order.status ??
                          "Unknown"}
                      </Badge>
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
