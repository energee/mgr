"use client";

/**
 * Finished Good Inventory Section
 *
 * Shows inventory stats, bin breakdown, and commitments for a finished good.
 * Used as a custom section on the FG detail page.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/universal/status-badge";
import { allocationEntity } from "@/entities/allocation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { finishedGoodKeys } from "@/lib/query-keys";
import Link from "next/link";

type FGInventorySectionProps = {
  data: Record<string, unknown>;
}

export function FGInventorySection({ data }: FGInventorySectionProps) {
  const fgId = data.id as string;
  const totalQty = (data.quantity as number) ?? 0;
  const allocatedQty = (data.allocated_quantity as number) ?? 0;
  const availableQty = (data.available_quantity as number) ?? 0;

  const supabase = createClient();

  // Fetch bin breakdown
  const { data: binRows, isLoading: binsLoading } = useQuery({
    queryKey: finishedGoodKeys.binInventory(fgId),
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("bin_inventory")
        .select("quantity, bin_id, bins(name, location_id, locations(name))")
        .eq("finished_good_id", fgId)
        .gt("quantity", 0)
        .order("quantity", { ascending: false });
      if (error) throw error;
      return rows;
    },
  });

  // Fetch commitments (allocations to orders)
  const { data: commitments, isLoading: commitmentsLoading } = useQuery({
    queryKey: finishedGoodKeys.commitments(fgId),
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("allocations")
        .select("id, quantity, status, destination_id, destination_type")
        .eq("source_type", "finished_good")
        .eq("source_id", fgId)
        .in("destination_type", ["order"])
        .in("status", ["planned", "completed"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return rows;
    },
  });

  return (
    <div className="space-y-4">
      {/* Stat Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-sm text-muted-foreground">Total</div>
            <div className="text-2xl font-semibold">{totalQty}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-sm text-muted-foreground">Allocated</div>
            <div className="text-2xl font-semibold">{allocatedQty}</div>
          </CardContent>
        </Card>
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-4 pb-4">
            <div className="text-sm text-muted-foreground">Available</div>
            <div className="text-2xl font-bold text-primary">
              {availableQty}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bin Breakdown */}
      <div>
        <h4 className="text-sm font-medium mb-2">Location Breakdown</h4>
        {binsLoading ? (
          <div className="text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin inline mr-1" />
            Loading...
          </div>
        ) : !binRows || binRows.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Not assigned to any bins
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Location</TableHead>
                <TableHead>Bin</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {binRows.map((row: Record<string, unknown>) => {
                const bin = row.bins as Record<string, unknown> | null;
                const location = bin?.locations as Record<
                  string,
                  unknown
                > | null;
                return (
                  <TableRow key={row.bin_id as string}>
                    <TableCell>
                      {(location?.name as string) ?? "\u2014"}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/inventory/bins/${row.bin_id}`}
                        className="text-primary hover:underline"
                      >
                        {(bin?.name as string) ?? "\u2014"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      {row.quantity as number}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Commitments */}
      <div>
        <h4 className="text-sm font-medium mb-2">Commitments</h4>
        {commitmentsLoading ? (
          <div className="text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin inline mr-1" />
            Loading...
          </div>
        ) : !commitments || commitments.length === 0 ? (
          <div className="text-sm text-muted-foreground">No commitments</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Destination</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {commitments.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      href={`/sales/orders/${row.destination_id}`}
                      className="text-primary hover:underline"
                    >
                      Order
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">{row.quantity}</TableCell>
                  <TableCell>
                    <StatusBadge
                      status={row.status}
                      config={allocationEntity.stateMachine?.stateDisplay}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
