"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { inventoryItemEntity } from "@/entities/inventory-item";

export default function NewInventoryItemPage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={inventoryItemEntity}
      basePath="/inventory/items"
    />
  );
}
