"use client";

import { EntityList } from "@/components/universal/entity-list";
import { purchaseOrderEntity } from "@/entities/purchase-order";

export default function PurchaseOrdersPage() {
  return <EntityList entity={purchaseOrderEntity} basePath="/purchasing/pos" />;
}
