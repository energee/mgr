"use client";

import { use } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { allocationEntity } from "@/entities/allocation";

export default function AllocationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailUnifiedWithErrorBoundary entity={allocationEntity} id={id} basePath="/inventory/allocations" />;
}
