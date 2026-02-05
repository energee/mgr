"use client";

import { use } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { kegInventoryEntity } from "@/entities/keg-inventory";

export default function KegInventoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailUnifiedWithErrorBoundary entity={kegInventoryEntity} id={id} basePath="/inventory/kegs" />;
}
