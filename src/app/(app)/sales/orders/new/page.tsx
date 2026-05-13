"use client";

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { orderEntity } from "@/entities/order";

export default function NewOrderPage() {
  return (
    <EntityDetailPage
      entity={orderEntity}
      basePath="/sales/orders"
    />
  );
}
