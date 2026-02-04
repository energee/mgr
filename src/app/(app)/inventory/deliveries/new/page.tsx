"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { deliveryEntity } from "@/entities/delivery";

export default function NewDeliveryPage() {
  return <EntityForm entity={deliveryEntity} basePath="/inventory/deliveries" />;
}
