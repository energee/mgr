"use client";

import { EntityList } from "@/components/universal/entity-list";
import { deliveryEntity } from "@/entities/delivery";

export default function DeliveriesPage() {
  return <EntityList entity={deliveryEntity} basePath="/inventory/deliveries" />;
}
