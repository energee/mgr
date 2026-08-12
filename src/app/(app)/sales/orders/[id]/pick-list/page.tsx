"use client";

/**
 * Order Pick List Page
 *
 * Stable per-order pick-list URL. Resolves the order's active formal pick
 * list (the `pick_lists` entity) and redirects to its canonical detail page,
 * /sales/pick-lists/[id], where the shared PickListItems component renders
 * the list with server-persisted picked quantities.
 *
 * If the order has no active pick list yet, shows an empty state pointing
 * back at the order page's "Generate Pick List" action (the
 * generate_pick_list RPC), which is what creates the list and its planned
 * allocations.
 */

import { use, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePickListForOrder } from "@/hooks/use-pick-list-for-order";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ClipboardList } from "lucide-react";

export default function OrderPickListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: pickList, isLoading, isFetching, isError, refetch } =
    usePickListForOrder(id);

  useEffect(() => {
    if (pickList) router.replace(`/sales/pick-lists/${pickList.id}`);
  }, [pickList, router]);

  // Skeleton while resolving (isFetching guards against asserting "no pick
  // list" from a stale cached null mid-refetch) and while the redirect for
  // a found list is in flight.
  if (isLoading || isFetching || pickList) {
    return <Skeleton className="h-64 w-full max-w-4xl" />;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <Link href={`/sales/orders/${id}`}>
        <Button variant="ghost" size="sm">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Order
        </Button>
      </Link>

      {isError ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <p className="text-destructive">Failed to load pick list</p>
          <Button onClick={() => refetch()}>Try Again</Button>
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <ClipboardList className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">No pick list for this order</p>
            <p className="text-muted-foreground mb-4">
              Generate one from the order page to start picking with FIFO
              allocation.
            </p>
            <Link href={`/sales/orders/${id}`}>
              <Button variant="outline">Go to Order</Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
