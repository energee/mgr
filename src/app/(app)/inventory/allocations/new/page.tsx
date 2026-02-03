"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { allocationEntity } from "@/entities/allocation";

export default function NewAllocationPage() {
  return <EntityForm entity={allocationEntity} basePath="/inventory/allocations" />;
}
