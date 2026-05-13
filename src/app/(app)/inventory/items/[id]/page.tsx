"use client";

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { inventoryItemEntity } from "@/entities/inventory-item";

export default function InventoryItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailPage entity={inventoryItemEntity} id={id} basePath="/inventory/items" />;
}
