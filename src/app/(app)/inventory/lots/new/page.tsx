"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { inventoryLotEntity } from "@/entities/inventory-lot";

export default function NewInventoryLotPage() {
  return <EntityForm entity={inventoryLotEntity} basePath="/inventory/lots" />;
}
