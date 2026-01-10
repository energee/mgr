"use client";

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { inventoryItemEntity } from "@/entities/inventory-item";

export default function EditInventoryItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityForm entity={inventoryItemEntity} id={id} basePath="/inventory/items" />;
}
