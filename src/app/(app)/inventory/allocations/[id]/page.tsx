"use client";

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { allocationEntity } from "@/entities/allocation";

export default function AllocationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailPage entity={allocationEntity} id={id} basePath="/inventory/allocations" />;
}
