"use client";

/**
 * Customer Orders tab — relation component for customer.relations.orders.
 *
 * Replaces the generic RelationTable so the tab can surface a "Reorder last"
 * action (S6): duplicates the customer's most recent non-cancelled order as a
 * new draft — fresh order number, order_date = today, line items copied with
 * unit prices re-resolved at current tier pricing (see reorder.ts) — then
 * navigates to it. The standard RelationTable affordances are preserved:
 * "Add" links to the order create form with the customer pre-filled
 * (?customer_id=, consumed by the create page's searchParams merge) and rows
 * navigate to order detail.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { entityKeys } from "@/lib/query-keys";
import { CACHE_DURATIONS } from "@/lib/constants";
import { formatValue } from "@/lib/utils";
import { resolveEntityBasePath } from "@/types/entity";
import { orderEntity } from "@/entities/order";
import { useReorderOrder } from "./reorder";
import { StatusBadge } from "@/components/universal/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Order columns shown on the tab (customer column is redundant here). */
const COLUMNS: { key: string; header: string; format?: "date" }[] = [
  { key: "order_number", header: "Order #" },
  { key: "status", header: "Status" },
  { key: "order_date", header: "Order Date", format: "date" },
  { key: "requested_date", header: "Requested", format: "date" },
  { key: "scheduled_date", header: "Scheduled", format: "date" },
];

export function CustomerOrdersRelation({ parentId }: { parentId: string; data?: Record<string, unknown> }) {
  const supabase = createClient();
  const router = useRouter();
  const reorder = useReorderOrder();
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Same query key shape RelationTable uses for this relation, so the
  // ["orders"] prefix invalidation in useReorderOrder covers it too.
  const { data: orders, isLoading, error } = useQuery({
    queryKey: entityKeys.related("orders", "customer_id", parentId),
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
    enabled: !!parentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_list_details")
        .select("id, order_number, status, order_date, requested_date, scheduled_date")
        .eq("customer_id", parentId)
        .order("order_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  // "Last order" = most recent non-cancelled order (reordering a cancelled
  // order is rarely what "reorder last" means).
  const lastOrder = orders?.find((o) => o.status !== "cancelled");
  const basePath = resolveEntityBasePath(orderEntity) ?? "/sales/orders";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Orders</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!lastOrder || reorder.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            <RotateCcw className="h-4 w-4" />
            {reorder.isPending ? "Reordering..." : "Reorder last"}
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link
              href={`${basePath}/new?customer_id=${parentId}`}
              aria-label="Add new order"
            >
              Add
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-center text-destructive py-8">Failed to load orders</p>
        ) : isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : !orders || orders.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No orders yet</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {COLUMNS.map((col) => (
                  <TableHead key={col.key}>{col.header}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => {
                const rowHref = `${basePath}/${order.id}`;
                return (
                  <TableRow
                    key={order.id}
                    className="cursor-pointer"
                    tabIndex={0}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("a, button")) return;
                      router.push(rowHref);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.target === e.currentTarget) {
                        e.preventDefault();
                        router.push(rowHref);
                      }
                    }}
                  >
                    {COLUMNS.map((col) => (
                      <TableCell key={col.key}>
                        {col.key === "status" ? (
                          <StatusBadge
                            status={order.status ?? ""}
                            config={orderEntity.stateMachine?.stateDisplay}
                          />
                        ) : (
                          formatValue(order[col.key as keyof typeof order], col.format)
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Confirm gate, matching the order detail Duplicate action's confirm */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reorder last order?</AlertDialogTitle>
            <AlertDialogDescription>
              Creates a new draft order copying the items from order{" "}
              {lastOrder?.order_number ?? ""} with prices refreshed to current
              tier pricing. Quantities and items can be adjusted on the draft.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (lastOrder?.id) reorder.mutate(lastOrder.id);
              }}
            >
              Reorder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
