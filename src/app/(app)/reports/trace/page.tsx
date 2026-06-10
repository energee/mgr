"use client";

/**
 * Batch Trace Report
 *
 * One-batch traceability in both directions (audit 9.5):
 * - Upstream: ingredient/material lot allocations into the batch
 *   (allocations with destination_type='batch'; populated by brew-day
 *   consumption and packaging material depletion).
 * - Downstream: finished goods produced from the batch (batch_id), the
 *   order allocations drawing on those finished goods (→ orders/customers),
 *   and keg transactions recorded against the batch (fills/ships → customers).
 *
 * Table-per-hop layout with links to the underlying records.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom } from "@/services/types";
import { reportKeys } from "@/lib/query-keys";
import {
  Card,
  CardContent,
  CardDescription,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { ArrowLeft } from "lucide-react";

// =============================================================================
// Types
// =============================================================================

type BatchOption = { id: string; batch_code: string; name: string };

type UpstreamRow = {
  id: string;
  lot_id: string | null;
  item_name: string | null;
  lot_number: string | null;
  quantity: number;
  unit: string | null;
  status: string;
  created_at: string | null;
  notes: string | null;
};

type FinishedGoodRow = {
  id: string;
  brand_name: string | null;
  selling_format_name: string | null;
  lot_number: string | null;
  quantity: number | null;
  production_date: string | null;
};

type OrderAllocationRow = {
  id: string;
  finished_good_id: string | null;
  finished_good_label: string;
  order_id: string | null;
  order_number: string | null;
  customer_name: string | null;
  quantity: number;
  status: string;
};

type KegTransactionRow = {
  id: string;
  transaction_type: string;
  quantity: number;
  customer_name: string | null;
  created_at: string | null;
};

type TraceData = {
  upstream: UpstreamRow[];
  finishedGoods: FinishedGoodRow[];
  orderAllocations: OrderAllocationRow[];
  kegTransactions: KegTransactionRow[];
};

// =============================================================================
// Page
// =============================================================================

export default function BatchTracePage() {
  const supabase = createClient();
  const [batchId, setBatchId] = useState("");

  // Batch picker options (most recent first)
  const { data: batches, isLoading: batchesLoading } = useQuery({
    queryKey: reportKeys.traceBatches(),
    queryFn: async (): Promise<BatchOption[]> => {
      const { data, error } = await supabase
        .from("batches")
        .select("id, batch_code, name")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: trace, isLoading: traceLoading, error } = useQuery({
    queryKey: reportKeys.trace(batchId),
    queryFn: async (): Promise<TraceData> => {
      // ----- Upstream: lot allocations into the batch -----
      const { data: upstreamAllocs, error: upErr } = await supabase
        .from("allocations")
        .select("id, source_id, quantity, status, lot_number, notes, created_at")
        .eq("destination_type", "batch")
        .eq("destination_id", batchId)
        .eq("source_type", "inventory_lot")
        .in("status", ["planned", "completed"])
        .order("created_at", { ascending: true });
      if (upErr) throw upErr;

      // Resolve lot → item names for the upstream rows
      const lotIds = [...new Set((upstreamAllocs ?? []).map((a) => a.source_id).filter((x): x is string => !!x))];
      const lotInfo = new Map<string, { item_name: string | null; lot_number: string | null; unit: string | null }>();
      if (lotIds.length > 0) {
        const { data: lots, error: lotErr } = await dynamicFrom(supabase, "inventory_lots_with_quantities")
          .select("id, item_name, lot_number, unit")
          .in("id", lotIds);
        if (lotErr) throw lotErr;
        for (const lot of (lots ?? []) as unknown as Array<{ id: string; item_name: string | null; lot_number: string | null; unit: string | null }>) {
          lotInfo.set(lot.id, lot);
        }
      }

      const upstream: UpstreamRow[] = (upstreamAllocs ?? []).map((a) => {
        const lot = a.source_id ? lotInfo.get(a.source_id) : undefined;
        return {
          id: a.id,
          lot_id: a.source_id,
          item_name: lot?.item_name ?? null,
          lot_number: a.lot_number ?? lot?.lot_number ?? null,
          quantity: a.quantity,
          unit: lot?.unit ?? null,
          status: a.status,
          created_at: a.created_at,
          notes: a.notes,
        };
      });

      // ----- Downstream hop 1: finished goods from the batch -----
      const { data: fgs, error: fgErr } = await supabase
        .from("finished_goods_with_availability")
        .select("id, brand_name, selling_format_name, lot_number, quantity, production_date")
        .eq("batch_id", batchId)
        .order("production_date", { ascending: true });
      if (fgErr) throw fgErr;
      const finishedGoods: FinishedGoodRow[] = (fgs ?? [])
        .filter((fg): fg is typeof fg & { id: string } => !!fg.id)
        .map((fg) => ({
          id: fg.id,
          brand_name: fg.brand_name,
          selling_format_name: fg.selling_format_name,
          lot_number: fg.lot_number,
          quantity: fg.quantity,
          production_date: fg.production_date,
        }));

      // ----- Downstream hop 2: order allocations from those finished goods -----
      let orderAllocations: OrderAllocationRow[] = [];
      const fgIds = finishedGoods.map((fg) => fg.id);
      if (fgIds.length > 0) {
        const { data: orderAllocs, error: oaErr } = await supabase
          .from("allocations")
          .select("id, source_id, destination_id, quantity, status")
          .eq("source_type", "finished_good")
          .eq("destination_type", "order")
          .in("source_id", fgIds)
          .in("status", ["planned", "completed"]);
        if (oaErr) throw oaErr;

        const orderIds = [...new Set((orderAllocs ?? []).map((a) => a.destination_id).filter((x): x is string => !!x))];
        const orderInfo = new Map<string, { order_number: string | null; customer_name: string | null }>();
        if (orderIds.length > 0) {
          const { data: orders, error: ordErr } = await supabase
            .from("orders")
            .select("id, order_number, customer:customers(name)")
            .in("id", orderIds);
          if (ordErr) throw ordErr;
          for (const o of orders ?? []) {
            orderInfo.set(o.id, {
              order_number: o.order_number,
              customer_name: (o.customer as { name: string } | null)?.name ?? null,
            });
          }
        }

        const fgLabel = new Map(
          finishedGoods.map((fg) => [
            fg.id,
            [fg.brand_name, fg.selling_format_name, fg.lot_number].filter(Boolean).join(" · "),
          ])
        );
        orderAllocations = (orderAllocs ?? []).map((a) => ({
          id: a.id,
          finished_good_id: a.source_id,
          finished_good_label: (a.source_id && fgLabel.get(a.source_id)) || "—",
          order_id: a.destination_id,
          order_number: a.destination_id ? orderInfo.get(a.destination_id)?.order_number ?? null : null,
          customer_name: a.destination_id ? orderInfo.get(a.destination_id)?.customer_name ?? null : null,
          quantity: a.quantity,
          status: a.status,
        }));
      }

      // ----- Downstream hop 3: keg transactions against the batch -----
      const { data: kegTx, error: kegErr } = await dynamicFrom(supabase, "keg_transactions_with_details")
        .select("id, transaction_type, quantity, customer_name, created_at")
        .eq("batch_id", batchId)
        .order("created_at", { ascending: true });
      if (kegErr) throw kegErr;
      const kegTransactions = ((kegTx ?? []) as unknown as KegTransactionRow[]);

      return { upstream, finishedGoods, orderAllocations, kegTransactions };
    },
    enabled: !!batchId,
  });

  const selectedBatch = batches?.find((b) => b.id === batchId);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Batch Trace</h1>
          <p className="text-muted-foreground mt-1">
            Trace a batch upstream to ingredient lots and downstream to
            finished goods, orders, customers, and keg shipments.
          </p>
        </div>
      </div>

      <div className="max-w-md space-y-2">
        <Label>Batch</Label>
        <Select value={batchId} onValueChange={setBatchId} disabled={batchesLoading}>
          <SelectTrigger className="min-h-[44px]">
            <SelectValue placeholder={batchesLoading ? "Loading..." : "Select a batch..."} />
          </SelectTrigger>
          <SelectContent>
            {batches?.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.batch_code} — {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <p className="text-sm text-destructive">
          Failed to load trace: {error instanceof Error ? error.message : "Unknown error"}
        </p>
      )}

      {batchId && traceLoading && (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {trace && selectedBatch && (
        <div className="space-y-6">
          {/* Upstream */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Upstream — Ingredient &amp; Material Lots
              </CardTitle>
              <CardDescription>
                Inventory lot allocations into {selectedBatch.batch_code}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {trace.upstream.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No ingredient lot allocations recorded for this batch yet.
                  These are created by the brew-day consumption confirmation
                  (Start Brew Day) and packaging material depletion.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Lot</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trace.upstream.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">
                          {row.item_name ?? row.notes ?? "—"}
                        </TableCell>
                        <TableCell>
                          {row.lot_id ? (
                            <Link href={`/inventory/lots/${row.lot_id}`} className="underline">
                              {row.lot_number ?? row.lot_id.slice(0, 8)}
                            </Link>
                          ) : (
                            row.lot_number ?? "—"
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.quantity} {row.unit ?? ""}
                        </TableCell>
                        <TableCell className="capitalize">{row.status}</TableCell>
                        <TableCell>
                          {row.created_at ? format(new Date(row.created_at), "MMM d, yyyy") : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Finished goods */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Finished Goods</CardTitle>
              <CardDescription>
                Packaged inventory produced from {selectedBatch.batch_code}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {trace.finishedGoods.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No finished goods produced from this batch yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Brand</TableHead>
                      <TableHead>Format</TableHead>
                      <TableHead>Lot</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead>Production Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trace.finishedGoods.map((fg) => (
                      <TableRow key={fg.id}>
                        <TableCell className="font-medium">
                          <Link href={`/inventory/finished-goods/${fg.id}`} className="underline">
                            {fg.brand_name ?? "—"}
                          </Link>
                        </TableCell>
                        <TableCell>{fg.selling_format_name ?? "—"}</TableCell>
                        <TableCell>{fg.lot_number ?? "—"}</TableCell>
                        <TableCell className="text-right">{fg.quantity ?? "—"}</TableCell>
                        <TableCell>
                          {fg.production_date
                            ? format(new Date(fg.production_date), "MMM d, yyyy")
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Orders / customers */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Orders &amp; Customers</CardTitle>
              <CardDescription>
                Order allocations drawing on this batch&apos;s finished goods.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {trace.orderAllocations.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No order allocations from this batch&apos;s finished goods.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Finished Good</TableHead>
                      <TableHead>Order</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trace.orderAllocations.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>{row.finished_good_label}</TableCell>
                        <TableCell>
                          {row.order_id ? (
                            <Link href={`/sales/orders/${row.order_id}`} className="underline">
                              {row.order_number ?? row.order_id.slice(0, 8)}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>{row.customer_name ?? "—"}</TableCell>
                        <TableCell className="text-right">{row.quantity}</TableCell>
                        <TableCell className="capitalize">{row.status}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Keg transactions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Keg Transactions</CardTitle>
              <CardDescription>
                Keg fills and shipments recorded against {selectedBatch.batch_code}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {trace.kegTransactions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No keg transactions recorded against this batch.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trace.kegTransactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="capitalize font-medium">
                          {tx.transaction_type.replace(/_/g, " ")}
                        </TableCell>
                        <TableCell className="text-right">{tx.quantity}</TableCell>
                        <TableCell>{tx.customer_name ?? "—"}</TableCell>
                        <TableCell>
                          {tx.created_at ? format(new Date(tx.created_at), "MMM d, yyyy") : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
