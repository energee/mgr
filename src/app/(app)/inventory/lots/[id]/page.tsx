"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { inventoryLotEntity } from "@/entities/inventory-lot";

export default function InventoryLotDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetail entity={inventoryLotEntity} id={id} basePath="/inventory/lots" />;
}
