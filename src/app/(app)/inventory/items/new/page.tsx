"use client";

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { inventoryItemEntity } from "@/entities/inventory-item";

export default function NewInventoryItemPage() {
  return (
    <EntityDetailPage
      entity={inventoryItemEntity}
      basePath="/inventory/items"
    />
  );
}
