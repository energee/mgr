"use client";

/**
 * Order Pick List Page
 *
 * Displays the pick list for an order with allocated finished goods.
 * Mobile-optimized for warehouse tablet use.
 */

import { use } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { OrderPickList } from "@/components/domain/order-pick-list";

export default function OrderPickListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <div className="space-y-6 max-w-4xl print:max-w-none print:space-y-4">
      {/* Back link - hidden in print */}
      <div className="print:hidden">
        <Link href={`/sales/orders/${id}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Order
          </Button>
        </Link>
      </div>

      <OrderPickList orderId={id} />
    </div>
  );
}
