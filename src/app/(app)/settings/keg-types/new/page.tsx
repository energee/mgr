"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { kegTypeEntity } from "@/entities/keg-type";

export default function NewKegTypePage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={kegTypeEntity}
      basePath="/settings/keg-types"
    />
  );
}
