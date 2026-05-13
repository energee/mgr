"use client";

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { inventoryLotEntity } from "@/entities/inventory-lot";

export default function NewInventoryLotPage() {
  return (
    <EntityDetailPage
      entity={inventoryLotEntity}
      basePath="/inventory/lots"
    />
  );
}
