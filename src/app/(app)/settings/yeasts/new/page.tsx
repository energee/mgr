"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { yeastStrainEntity } from "@/entities/yeast-strain";

export default function NewYeastStrainPage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={yeastStrainEntity}
      basePath="/settings/yeasts"
    />
  );
}
