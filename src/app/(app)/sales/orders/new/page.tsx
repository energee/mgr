"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { orderEntity } from "@/entities/order";

export default function NewOrderPage() {
  return <EntityForm entity={orderEntity} basePath="/sales/orders" />;
}
