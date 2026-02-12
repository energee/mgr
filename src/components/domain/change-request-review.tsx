"use client";

/**
 * ChangeRequestReview - Inline diff view for pending customer change requests
 *
 * Shows pending change request details on the admin order detail page,
 * with approve/reject actions. Displays a diff table comparing current
 * order items with proposed changes.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { entityKeys, changeRequestKeys } from "@/lib/query-keys";
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
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, Check, X, ArrowUp, ArrowDown } from "lucide-react";

// =============================================================================
// Types
// =============================================================================

interface ChangeRequestReviewProps {
  parentId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: { id: string | null } & Record<string, any>;
}

interface ChangeRequestItem {
  id: string;
  change_type: "add" | "modify" | "remove";
  order_item_id: string | null;
  brand_id: string | null;
  package_type_id: string | null;
  keg_type_id: string | null;
  quantity: number | null;
  original_quantity: number | null;
  brands: { name: string } | null;
  package_types: { name: string } | null;
  keg_types: { name: string } | null;
}

interface PendingRequest {
  id: string;
  status: string;
  notes: string | null;
  created_at: string;
  requested_by: string | null;
  order_change_request_items: ChangeRequestItem[];
}

interface OrderItem {
  id: string;
  brand_id: string | null;
  package_type_id: string | null;
  keg_type_id: string | null;
  quantity: number;
  brands: { name: string } | null;
  package_types: { name: string } | null;
  keg_types: { name: string } | null;
}

// =============================================================================
// Component
// =============================================================================

export function ChangeRequestReview({ parentId, data }: ChangeRequestReviewProps) {
  // Resolve the order ID from either parentId or data.id
  const orderId = parentId || data?.id;

  const supabase = createClient();
  const queryClient = useQueryClient();
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  // ---------------------------------------------------------------------------
  // Data Fetching
  // ---------------------------------------------------------------------------

  const { data: pendingRequest, isLoading } = useQuery({
    queryKey: changeRequestKeys.pendingForOrder(orderId || ""),
    enabled: !!orderId,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { data: result, error } = await db
        .from("order_change_requests")
        .select(`
          id, status, notes, created_at, requested_by,
          order_change_request_items (
            id, change_type, order_item_id, brand_id, package_type_id, keg_type_id,
            quantity, original_quantity,
            brands (name),
            package_types (name),
            keg_types (name)
          )
        `)
        .eq("order_id", orderId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return result as PendingRequest | null;
    },
  });

  const { data: orderItems } = useQuery({
    queryKey: entityKeys.detail("order_items_for_review", orderId || ""),
    enabled: !!orderId,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { data: result, error } = await db
        .from("order_items")
        .select("id, brand_id, package_type_id, keg_type_id, quantity, brands(name), package_types(name), keg_types(name)")
        .eq("order_id", orderId);
      if (error) throw error;
      return result as OrderItem[];
    },
  });

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/orders/${orderId}/change-requests/${pendingRequest!.id}/approve`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error?.message || "Failed to approve");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: changeRequestKeys.forOrder(orderId!) });
      queryClient.invalidateQueries({ queryKey: changeRequestKeys.pendingForOrder(orderId!) });
      queryClient.invalidateQueries({ queryKey: entityKeys.detail("orders", orderId!) });
      toast.success("Change request approved");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (reason: string) => {
      const res = await fetch(
        `/api/orders/${orderId}/change-requests/${pendingRequest!.id}/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        }
      );
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error?.message || "Failed to reject");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: changeRequestKeys.forOrder(orderId!) });
      queryClient.invalidateQueries({ queryKey: changeRequestKeys.pendingForOrder(orderId!) });
      toast.success("Change request rejected");
      setShowRejectDialog(false);
      setRejectReason("");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function getFormatLabel(item: ChangeRequestItem | OrderItem): string {
    if (item.keg_types?.name) return item.keg_types.name;
    if (item.package_types?.name) return item.package_types.name;
    return "-";
  }

  function getProductName(item: ChangeRequestItem | OrderItem): string {
    return item.brands?.name || "-";
  }

  function findOriginalItem(changeItem: ChangeRequestItem): OrderItem | undefined {
    if (!orderItems || !changeItem.order_item_id) return undefined;
    return orderItems.find((oi) => oi.id === changeItem.order_item_id);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  if (!orderId) return null;

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!pendingRequest) {
    return (
      <p className="text-sm text-muted-foreground">
        No pending change requests.
      </p>
    );
  }

  const items = pendingRequest.order_change_request_items || [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">Customer Change Request</span>
            <Badge variant="outline">Pending</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Submitted{" "}
            {new Date(pendingRequest.created_at).toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </p>
          {pendingRequest.notes && (
            <p className="text-sm italic text-muted-foreground">
              &ldquo;{pendingRequest.notes}&rdquo;
            </p>
          )}
        </div>
      </div>

      {/* Diff Table */}
      {items.length > 0 && (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Change</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Format</TableHead>
                <TableHead className="text-right w-[100px]">Current</TableHead>
                <TableHead className="text-right w-[100px]">Proposed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const original = findOriginalItem(item);
                const currentQty =
                  item.change_type === "add"
                    ? null
                    : item.original_quantity ?? original?.quantity ?? null;
                const proposedQty =
                  item.change_type === "remove" ? null : item.quantity;

                return (
                  <TableRow
                    key={item.id}
                    className={
                      item.change_type === "add"
                        ? "bg-green-50 dark:bg-green-950/20"
                        : item.change_type === "remove"
                          ? "bg-red-50 dark:bg-red-950/20"
                          : ""
                    }
                  >
                    <TableCell>
                      <Badge
                        variant={
                          item.change_type === "add"
                            ? "default"
                            : item.change_type === "remove"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {item.change_type.charAt(0).toUpperCase() +
                          item.change_type.slice(1)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          item.change_type === "remove"
                            ? "line-through text-muted-foreground"
                            : ""
                        }
                      >
                        {getProductName(item)}
                      </span>
                    </TableCell>
                    <TableCell>{getFormatLabel(item)}</TableCell>
                    <TableCell className="text-right">
                      {currentQty != null ? currentQty : (
                        <span className="text-muted-foreground">&mdash;</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {proposedQty != null ? (
                        <span className="inline-flex items-center gap-1">
                          {proposedQty}
                          {item.change_type === "modify" &&
                            currentQty != null &&
                            proposedQty !== currentQty && (
                              proposedQty > currentQty ? (
                                <ArrowUp className="h-3.5 w-3.5 text-green-600" />
                              ) : (
                                <ArrowDown className="h-3.5 w-3.5 text-red-600" />
                              )
                            )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">&mdash;</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2">
        <Button
          onClick={() => approveMutation.mutate()}
          disabled={approveMutation.isPending || rejectMutation.isPending}
          size="sm"
        >
          <Check className="h-4 w-4 mr-1.5" />
          Approve
        </Button>
        <Button
          variant="outline"
          onClick={() => setShowRejectDialog(true)}
          disabled={approveMutation.isPending || rejectMutation.isPending}
          size="sm"
        >
          <X className="h-4 w-4 mr-1.5" />
          Reject
        </Button>
      </div>

      {/* Reject Dialog */}
      <AlertDialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Change Request</AlertDialogTitle>
            <AlertDialogDescription>
              Provide a reason for rejecting this change request. The customer
              will be notified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Reason for rejection..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
          />
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setRejectReason("");
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => rejectMutation.mutate(rejectReason)}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? "Rejecting..." : "Reject"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
