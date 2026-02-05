"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { brandEntity } from "@/entities/brand";

export default function NewBrandPage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={brandEntity}
      basePath="/settings/brands"
    />
  );
}
