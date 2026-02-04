"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { deliveryEntity } from "@/entities/delivery";

export default function DeliveryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetail entity={deliveryEntity} id={id} basePath="/inventory/deliveries" />;
}
