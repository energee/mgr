"use client";

import { use } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { deliveryEntity } from "@/entities/delivery";

export default function DeliveryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailUnifiedWithErrorBoundary entity={deliveryEntity} id={id} basePath="/inventory/deliveries" />;
}
