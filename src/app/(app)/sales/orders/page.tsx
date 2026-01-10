"use client";

import { EntityList } from "@/components/universal/entity-list";
import { orderEntity } from "@/entities/order";

export default function OrdersPage() {
  return <EntityList entity={orderEntity} basePath="/sales/orders" />;
}
