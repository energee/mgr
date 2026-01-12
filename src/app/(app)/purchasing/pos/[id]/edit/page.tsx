"use client";

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { purchaseOrderEntity } from "@/entities/purchase-order";

export default function EditPurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityForm entity={purchaseOrderEntity} id={id} basePath="/purchasing/pos" />;
}
