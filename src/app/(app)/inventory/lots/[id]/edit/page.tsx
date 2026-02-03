"use client";

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { inventoryLotEntity } from "@/entities/inventory-lot";

export default function EditInventoryLotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityForm entity={inventoryLotEntity} id={id} basePath="/inventory/lots" />;
}
