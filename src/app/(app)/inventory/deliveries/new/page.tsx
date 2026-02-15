"use client";

import { EntityDetailUnified } from "@/components/universal/entity-detail-unified";
import { deliveryEntity } from "@/entities/delivery";

export default function NewDeliveryPage() {
  return <EntityDetailUnified entity={deliveryEntity} basePath="/inventory/deliveries" />;
}
