"use client";

import { EntityList } from "@/components/universal/entity-list";
import { inventoryLotEntity } from "@/entities/inventory-lot";

export default function InventoryLotsPage() {
  return <EntityList entity={inventoryLotEntity} basePath="/inventory/lots" />;
}
