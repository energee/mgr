"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { waterAdditionProfileEntity } from "@/entities/water-addition-profile";

export default function NewWaterAdditionProfilePage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={waterAdditionProfileEntity}
      basePath="/settings/water-addition-profiles"
    />
  );
}
