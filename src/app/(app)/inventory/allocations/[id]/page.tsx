"use client";

import { use } from "react";
import { EntityDetailUnified } from "@/components/universal/entity-detail-unified";
import { allocationEntity } from "@/entities/allocation";

export default function AllocationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailUnified entity={allocationEntity} id={id} basePath="/inventory/allocations" />;
}
