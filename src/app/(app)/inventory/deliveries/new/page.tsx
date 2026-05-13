"use client";

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { deliveryEntity } from "@/entities/delivery";

export default function NewDeliveryPage() {
  return <EntityDetailPage entity={deliveryEntity} basePath="/inventory/deliveries" />;
}
