"use client";

import { EntityList } from "@/components/universal/entity-list";
import { inventoryItemEntity } from "@/entities/inventory-item";

export default function InventoryItemsPage() {
  return <EntityList entity={inventoryItemEntity} basePath="/inventory/items" />;
}
