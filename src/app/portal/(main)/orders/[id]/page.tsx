"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom } from "@/services/types";
import { entityKeys, changeRequestKeys, portalKeys } from "@/lib/query-keys";
import { formatCurrency } from "@/lib/format";
import { usePortalCustomer } from "@/lib/portal-context";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/universal/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { orderEntity, changeRequestStatusDisplay } from "@/entities/order";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORDER_STATES = orderEntity.stateMachine?.states ?? [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isBelowCutoff(orderStatus: string, cutoffState: string): boolean {
  const orderRank = ORDER_STATES.indexOf(orderStatus);
  const cutoffRank = ORDER_STATES.indexOf(cutoffState);
  if (orderRank === -1 || cutoffRank === -1) return false;
  return orderRank < cutoffRank;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function changeTypeLabel(changeType: string): string {
  return changeType.charAt(0).toUpperCase() + changeType.slice(1);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrderItem {
  id: string;
  brand_id: string;
  selling_format_id: string | null;
  quantity: number;
  unit_price: number;
  brands: { id: string; name: string } | null;
  selling_formats: { id: string; name: string } | null;
}

interface Order {
  id: string;
  order_number: string;
  status: string;
  order_date: string;
  requested_date: string | null;
  scheduled_date: string | null;
  notes: string | null;
  customer_id: string;
  order_items: OrderItem[];
}

interface ChangeRequestItem {
  id: string;
  change_type: string;
  order_item_id: string | null;
  brand_id: string | null;
  selling_format_id: string | null;
  quantity: number | null;
  original_quantity: number | null;
}

interface ChangeRequest {
  id: string;
  status: string;
  notes: string | null;
  rejection_reason: string | null;
  created_at: string;
  order_change_request_items: ChangeRequestItem[];
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function PortalOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const supabase = createClient();
  // Accessed to ensure this page is rendered within the portal context
  usePortalCustomer();

  // ---- Query 1: Order + Items ----
  const { data: order, isLoading: orderLoading } = useQuery<Order>({
    queryKey: entityKeys.detail("orders", id),
    queryFn: async () => {
      const { data, error } = await dynamicFrom(supabase, "orders")
        .select(
          `
          id, order_number, status, order_date, requested_date, scheduled_date, notes,
          customer_id,
          order_items (
            id, brand_id, selling_format_id, quantity, unit_price,
            brands (id, name),
            selling_formats (id, name)
          )
        `
        )
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // ---- Query 2: Change Requests ----
  const { data: changeRequests } = useQuery<ChangeRequest[]>({
    queryKey: changeRequestKeys.forOrder(id),
    queryFn: async () => {
      const { data, error } = await dynamicFrom(supabase, "order_change_requests")
        .select(
          `
          id, status, notes, rejection_reason, created_at,
          order_change_request_items (
            id, change_type, order_item_id, brand_id, selling_format_id,
            quantity, original_quantity
          )
        `
        )
        .eq("order_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // ---- Query 3: Cutoff Check (derive from order's customer) ----
  const { data: cutoffState } = useQuery<string>({
    queryKey: portalKeys.cutoff(id),
    queryFn: async () => {
      const { data: orderRow } = await dynamicFrom(supabase, "orders")
        .select("customer_id, customers(sales_channel_id, sales_channels(change_request_cutoff_state))")
        .eq("id", id)
        .single();
      return (
        orderRow?.customers?.sales_channels?.change_request_cutoff_state || "confirmed"
      );
    },
    enabled: !!id,
  });

  // ---- Derived State ----
  const pendingRequest = changeRequests?.find((cr) => cr.status === "pending");
  const mostRecentRequest = changeRequests?.[0];
  const historyRequests = changeRequests?.filter(
    (cr) => cr.status !== "pending"
  );

  const canRequestChanges =
    order &&
    cutoffState &&
    isBelowCutoff(order.status, cutoffState) &&
    !pendingRequest;

  const orderTotal =
    order?.order_items?.reduce(
      (sum, item) => sum + item.quantity * item.unit_price,
      0
    ) ?? 0;

  // ---- Loading State ----
  if (orderLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  // ---- Not Found ----
  if (!order) {
    return (
      <div className="space-y-4">
        <Link
          href="/portal/orders"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Orders
        </Link>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Order not found.
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- Render ----
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/portal/orders"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Orders
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            Order #{order.order_number}
          </h1>
          <StatusBadge status={order.status} config={orderEntity.stateMachine?.stateDisplay} />
        </div>
      </div>

      {/* Order Details */}
      <Card>
        <CardHeader>
          <CardTitle>Order Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">
                Order Date
              </dt>
              <dd className="mt-1 text-sm">{formatDate(order.order_date)}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">
                Requested Date
              </dt>
              <dd className="mt-1 text-sm">
                {formatDate(order.requested_date)}
              </dd>
            </div>
            {order.scheduled_date && (
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  Scheduled Date
                </dt>
                <dd className="mt-1 text-sm">
                  {formatDate(order.scheduled_date)}
                </dd>
              </div>
            )}
            {order.notes && (
              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-sm font-medium text-muted-foreground">
                  Notes
                </dt>
                <dd className="mt-1 text-sm">{order.notes}</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Order Items */}
      <Card>
        <CardHeader>
          <CardTitle>Order Items</CardTitle>
        </CardHeader>
        <CardContent>
          {order.order_items?.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.order_items.map((item) => {
                    const format =
                      item.selling_formats?.name || "-";
                    const lineTotal = item.quantity * item.unit_price;
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          {item.brands?.name ?? "-"}
                        </TableCell>
                        <TableCell>{format}</TableCell>
                        <TableCell className="text-right">
                          {item.quantity}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(item.unit_price)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(lineTotal)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="mt-4 flex justify-end">
                <div className="text-right">
                  <span className="text-sm font-medium text-muted-foreground">
                    Total:{" "}
                  </span>
                  <span className="text-lg font-semibold">
                    {formatCurrency(orderTotal)}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No items on this order.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Request Changes Button / Pending Request Card */}
      {canRequestChanges && (
        <div>
          <Button asChild>
            <Link href={`/portal/orders/${id}/change-request/new`}>
              Request Changes
            </Link>
          </Button>
        </div>
      )}

      {pendingRequest && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <CardTitle>Pending Change Request</CardTitle>
              <StatusBadge
                status="pending"
                config={changeRequestStatusDisplay}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingRequest.notes && (
              <div>
                <span className="text-sm font-medium text-muted-foreground">
                  Notes:{" "}
                </span>
                <span className="text-sm">{pendingRequest.notes}</span>
              </div>
            )}
            {pendingRequest.order_change_request_items?.length > 0 && (
              <div>
                <span className="text-sm font-medium text-muted-foreground">
                  Requested Changes:
                </span>
                <ul className="mt-1 list-inside list-disc space-y-1 text-sm">
                  {pendingRequest.order_change_request_items.map((item) => (
                    <li key={item.id}>
                      {changeTypeLabel(item.change_type)}
                      {item.quantity != null && ` - Qty: ${item.quantity}`}
                      {item.original_quantity != null &&
                        ` (was ${item.original_quantity})`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Rejected Most-Recent Request */}
      {!pendingRequest &&
        mostRecentRequest?.status === "rejected" &&
        mostRecentRequest.rejection_reason && (
          <Card className="border-destructive/50">
            <CardHeader>
              <div className="flex items-center gap-3">
                <CardTitle>Change Request Rejected</CardTitle>
                <StatusBadge
                  status="rejected"
                  config={changeRequestStatusDisplay}
                />
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                <span className="font-medium text-muted-foreground">
                  Reason:{" "}
                </span>
                {mostRecentRequest.rejection_reason}
              </p>
            </CardContent>
          </Card>
        )}

      {/* Change Request History */}
      {historyRequests && historyRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Change Request History</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {historyRequests.map((cr) => (
                <li
                  key={cr.id}
                  className="flex items-start justify-between gap-4 border-b pb-3 last:border-0 last:pb-0"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <StatusBadge
                        status={cr.status}
                        config={changeRequestStatusDisplay}
                      />
                      <span className="text-sm text-muted-foreground">
                        {formatDate(cr.created_at)}
                      </span>
                    </div>
                    {cr.order_change_request_items?.length > 0 && (
                      <p className="text-sm text-muted-foreground">
                        {cr.order_change_request_items.length} item
                        {cr.order_change_request_items.length !== 1
                          ? " changes"
                          : " change"}
                      </p>
                    )}
                    {cr.status === "rejected" && cr.rejection_reason && (
                      <p className="text-sm text-destructive">
                        Reason: {cr.rejection_reason}
                      </p>
                    )}
                    {cr.notes && (
                      <p className="text-sm text-muted-foreground">
                        {cr.notes}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
