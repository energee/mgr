"use client";

/**
 * Customer Detail Page
 *
 * Custom customer detail that wraps EntityDetail with the
 * CustomerKegBalances component for detailed keg tracking.
 */

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { customerEntity } from "@/entities/customer";
import { CustomerKegBalances } from "@/components/domain/customer-keg-balances";

export default function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <div className="space-y-6">
      <EntityDetail
        entity={customerEntity}
        id={id}
        basePath="/sales/customers"
      />

      {/* Detailed keg balance breakdown by type */}
      <CustomerKegBalances customerId={id} />
    </div>
  );
}
