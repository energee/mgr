"use client";

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { kegInventoryEntity } from "@/entities/keg-inventory";

export default function KegInventoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailPage entity={kegInventoryEntity} id={id} basePath="/inventory/kegs" />;
}
