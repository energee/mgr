"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { purchaseOrderEntity } from "@/entities/purchase-order";

export default function NewPurchaseOrderPage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={purchaseOrderEntity}
      basePath="/purchasing/pos"
    />
  );
}
