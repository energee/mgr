"use client";

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { orderEntity } from "@/entities/order";

export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <EntityDetailPage
      entity={orderEntity}
      id={id}
      basePath="/sales/orders"
    />
  );
}
