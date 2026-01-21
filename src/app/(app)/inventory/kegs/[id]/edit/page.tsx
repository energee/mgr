"use client";

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { kegInventoryEntity } from "@/entities/keg-inventory";

export default function EditKegInventoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityForm entity={kegInventoryEntity} id={id} basePath="/inventory/kegs" />;
}
