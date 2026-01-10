"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { inventoryItemEntity } from "@/entities/inventory-item";

export default function InventoryItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetail entity={inventoryItemEntity} id={id} basePath="/inventory/items" />;
}
