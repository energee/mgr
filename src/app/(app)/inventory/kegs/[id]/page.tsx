"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { kegInventoryEntity } from "@/entities/keg-inventory";

export default function KegInventoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetail entity={kegInventoryEntity} id={id} basePath="/inventory/kegs" />;
}
