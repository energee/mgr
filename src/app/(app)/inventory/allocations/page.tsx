"use client";

import { EntityList } from "@/components/universal/entity-list";
import { allocationEntity } from "@/entities/allocation";

export default function AllocationsPage() {
  return <EntityList entity={allocationEntity} basePath="/inventory/allocations" />;
}
