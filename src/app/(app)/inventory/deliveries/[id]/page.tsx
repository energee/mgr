"use client";

import { use } from "react";
import { EntityDetailUnified } from "@/components/universal/entity-detail-unified";
import { deliveryEntity } from "@/entities/delivery";

export default function DeliveryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailUnified entity={deliveryEntity} id={id} basePath="/inventory/deliveries" />;
}
