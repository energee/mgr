"use client";

/**
 * New Sales Order page.
 *
 * Prefills order_number with the next suggestion in the ORD-YYYY-NNN
 * sequence (race-safe generate_next_order_number(), migration 00186) so the
 * user no longer invents order numbers by hand. The suggestion stays
 * editable; the orders_order_number_key UNIQUE constraint backstops
 * concurrent suggestions at save. A ?order_number= deep link suppresses the
 * fetch — EntityDetailPage merges URL params into the form defaults itself.
 */

import { useSearchParams } from "next/navigation";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { Skeleton } from "@/components/ui/skeleton";
import { orderEntity } from "@/entities/order";
import { generateNextOrderNumber } from "@/domain/sales/order-number";
import { useSuggestedNumber } from "@/hooks/use-suggested-number";

export default function NewOrderPage() {
  const searchParams = useSearchParams();
  const { suggested, resolved } = useSuggestedNumber(
    generateNextOrderNumber,
    searchParams.has("order_number"),
  );

  // Form defaults are captured at mount — hold rendering until the
  // suggestion resolves (or fails, falling back to manual entry).
  if (!resolved) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <EntityDetailPage
      entity={orderEntity}
      basePath="/sales/orders"
      defaultValues={suggested ? { order_number: suggested } : undefined}
    />
  );
}
