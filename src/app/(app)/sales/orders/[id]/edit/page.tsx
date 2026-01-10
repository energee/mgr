"use client";

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { orderEntity } from "@/entities/order";

export default function EditOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityForm entity={orderEntity} id={id} basePath="/sales/orders" />;
}
