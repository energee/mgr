"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { orderEntity } from "@/entities/order";

export default function NewOrderPage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={orderEntity}
      basePath="/sales/orders"
    />
  );
}
