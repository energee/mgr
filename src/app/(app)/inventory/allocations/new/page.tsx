"use client";

import { EntityDetailUnified } from "@/components/universal/entity-detail-unified";
import { allocationEntity } from "@/entities/allocation";

export default function NewAllocationPage() {
  return <EntityDetailUnified entity={allocationEntity} basePath="/inventory/allocations" />;
}
