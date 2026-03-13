"use client";

/**
 * Order Allocations Page
 *
 * View and manage inventory allocations for an order.
 * Shows existing allocations and allows adding more.
 */

import { use, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { ArrowLeft, Plus, Package, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { OrderAllocation } from "@/components/domain/order-allocation";
import { orderKeys, inventoryKeys } from "@/lib/query-keys";
import { log } from "@/lib/client-logger";

// =============================================================================
// Types
// =============================================================================

type AllocationItem = {
  id: string;
  finished_good_id: string;
  lot_number: string;
  brand_name: string;
  package_name: string;
  quantity: number;
  status: string;
}

// =============================================================================
// Component
// =============================================================================

export default function OrderAllocationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const supabase = createClient();
  const queryClient = useQueryClient();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Fetch order details
  const { data: order, isLoading: orderLoading } = useQuery({
    queryKey: orderKeys.detail(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_number, status")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Fetch allocations for this order
  const { data: allocations = [], isLoading: allocationsLoading } = useQuery({
    queryKey: orderKeys.allocations(id),
    queryFn: async () => {
      // Get allocations
      const { data: allocs, error: allocError } = await supabase
        .from("allocations")
        .select("id, source_id, quantity, status")
        .eq("destination_type", "order")
        .eq("destination_id", id)
        .in("status", ["planned", "completed"]);

      if (allocError) throw allocError;
      if (!allocs || allocs.length === 0) return [];

      // Get finished goods
      const fgIds = allocs.map((a) => a.source_id).filter((id): id is string => !!id);
      const { data: finishedGoods } = await supabase
        .from("finished_goods")
        .select("id, lot_number, brand_id, selling_format_id")
        .in("id", fgIds);

      // Get brands and selling formats
      const brandIds = [...new Set(finishedGoods?.map((fg) => fg.brand_id).filter((id): id is string => !!id))];
      const formatIds = [...new Set(finishedGoods?.map((fg) => fg.selling_format_id).filter((id): id is string => !!id))];

      const [brandsResult, formatsResult] = await Promise.all([
        brandIds.length > 0
          ? supabase.from("brands").select("id, name").in("id", brandIds)
          : { data: [] },
        formatIds.length > 0
          ? supabase.from("selling_formats").select("id, name").in("id", formatIds)
          : { data: [] },
      ]);

      const brandMap = new Map((brandsResult.data || []).map((b) => [b.id, b.name]));
      const formatMap = new Map((formatsResult.data || []).map((f) => [f.id, f.name]));
      const fgMap = new Map(finishedGoods?.map((fg) => [fg.id, fg]));

      return allocs
        .filter((a) => a.source_id && fgMap.has(a.source_id))
        .map((a) => {
          const fg = fgMap.get(a.source_id!)!;
          return {
            id: a.id,
            finished_good_id: fg.id,
            lot_number: fg.lot_number || "N/A",
            brand_name: (fg.brand_id && brandMap.get(fg.brand_id)) || "Unknown",
            package_name: (fg.selling_format_id && formatMap.get(fg.selling_format_id)) || "Unknown",
            quantity: a.quantity,
            status: a.status,
          } as AllocationItem;
        });
    },
  });

  // Delete allocation mutation
  const deleteMutation = useMutation({
    mutationFn: async (allocationId: string) => {
      const { error } = await supabase
        .from("allocations")
        .delete()
        .eq("id", allocationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderKeys.allocations(id) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.finishedGoods() });
      toast.success("Allocation removed");
      setDeleteId(null);
    },
    onError: (error) => {
      log.error("Delete error:", error);
      toast.error("Failed to remove allocation");
    },
  });

  const isLoading = orderLoading || allocationsLoading;
  const totalQuantity = allocations.reduce((sum, a) => sum + a.quantity, 0);
  const canEdit = order?.status && !["fulfilled", "cancelled"].includes(order.status);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/sales/orders/${id}`}>
          <Button variant="ghost" size="icon" aria-label="Back to order">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Package className="h-5 w-5" />
            Allocations
          </h1>
          <p className="text-muted-foreground">
            Order {order?.order_number}
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setShowAddDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Allocation
          </Button>
        )}
      </div>

      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-muted-foreground">Total Allocations</div>
              <div className="text-2xl font-bold">{allocations.length}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Total Quantity</div>
              <div className="text-2xl font-bold">{totalQuantity}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Allocations Table */}
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : allocations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">No allocations yet</p>
            <p className="text-muted-foreground mb-4">
              Allocate finished goods to this order.
            </p>
            {canEdit && (
              <Button onClick={() => setShowAddDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Allocation
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Lot #</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead>Status</TableHead>
                {canEdit && <TableHead className="w-[50px]"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {allocations.map((alloc) => (
                <TableRow key={alloc.id}>
                  <TableCell>
                    <div className="font-medium">{alloc.brand_name}</div>
                    <div className="text-sm text-muted-foreground">
                      {alloc.package_name}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {alloc.lot_number}
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {alloc.quantity}
                  </TableCell>
                  <TableCell>
                    <Badge variant={alloc.status === "completed" ? "default" : "secondary"}>
                      {alloc.status}
                    </Badge>
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete allocation"
                        onClick={() => setDeleteId(alloc.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Add Allocation Dialog */}
      <OrderAllocation
        orderId={id}
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: orderKeys.allocations(id) });
        }}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
<AlertDialogTitle>Remove allocation?</AlertDialogTitle>
            <AlertDialogDescription>
              The finished goods will be returned to available inventory. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline">Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Remove"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
