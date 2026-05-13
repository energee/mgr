"use client";

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { inventoryLotEntity } from "@/entities/inventory-lot";

export default function InventoryLotDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailPage entity={inventoryLotEntity} id={id} basePath="/inventory/lots" />;
}
