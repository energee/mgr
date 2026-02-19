"use client";

/**
 * New Water Addition Profile Page
 */

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { waterAdditionProfileEntity } from "@/entities/water-addition-profile";

export default function NewWaterAdditionProfilePage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={waterAdditionProfileEntity}
      basePath="/settings/water-profiles/additions"
    />
  );
}
