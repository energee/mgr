"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { inventoryItemEntity } from "@/entities/inventory-item";

export default function NewInventoryItemPage() {
  return <EntityForm entity={inventoryItemEntity} basePath="/inventory/items" />;
}
