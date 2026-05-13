"use client";

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { purchaseOrderEntity } from "@/entities/purchase-order";

export default function NewPurchaseOrderPage() {
  return (
    <EntityDetailPage
      entity={purchaseOrderEntity}
      basePath="/purchasing/pos"
    />
  );
}
