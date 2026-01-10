"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { orderEntity } from "@/entities/order";

export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetail entity={orderEntity} id={id} basePath="/sales/orders" />;
}
