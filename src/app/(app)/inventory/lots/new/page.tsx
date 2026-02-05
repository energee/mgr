"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { inventoryLotEntity } from "@/entities/inventory-lot";

export default function NewInventoryLotPage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={inventoryLotEntity}
      basePath="/inventory/lots"
    />
  );
}
