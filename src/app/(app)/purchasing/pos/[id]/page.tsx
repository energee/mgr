"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { purchaseOrderEntity } from "@/entities/purchase-order";

export default function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetail entity={purchaseOrderEntity} id={id} basePath="/purchasing/pos" />;
}
