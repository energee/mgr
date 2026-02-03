"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { allocationEntity } from "@/entities/allocation";

export default function AllocationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetail entity={allocationEntity} id={id} basePath="/inventory/allocations" />;
}
