"use client";

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { allocationEntity } from "@/entities/allocation";

export default function NewAllocationPage() {
  return <EntityDetailPage entity={allocationEntity} basePath="/inventory/allocations" />;
}
