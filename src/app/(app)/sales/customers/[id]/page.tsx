"use client";

/**
 * Customer Detail Page
 *
 * Uses unified detail/edit with the CustomerKegBalances component
 * for detailed keg tracking.
 */

import { use } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
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
      <EntityDetailUnifiedWithErrorBoundary
        entity={customerEntity}
        id={id}
        basePath="/sales/customers"
      />

      {/* Detailed keg balance breakdown by type */}
      <CustomerKegBalances customerId={id} />
    </div>
  );
}
