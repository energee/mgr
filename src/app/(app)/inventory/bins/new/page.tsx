"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { binEntity } from "@/entities/bin";

export default function NewBinPage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={binEntity}
      basePath="/inventory/bins"
    />
  );
}
