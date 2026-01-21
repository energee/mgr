"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { kegInventoryEntity } from "@/entities/keg-inventory";

export default function NewKegInventoryPage() {
  return <EntityForm entity={kegInventoryEntity} basePath="/inventory/kegs" />;
}
