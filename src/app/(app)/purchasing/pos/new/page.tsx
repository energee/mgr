"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { purchaseOrderEntity } from "@/entities/purchase-order";

export default function NewPurchaseOrderPage() {
  return <EntityForm entity={purchaseOrderEntity} basePath="/purchasing/pos" />;
}
