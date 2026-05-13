"use client";

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { deliveryEntity } from "@/entities/delivery";

export default function DeliveryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailPage entity={deliveryEntity} id={id} basePath="/inventory/deliveries" />;
}
