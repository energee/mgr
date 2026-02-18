"use client";

/**
 * New Water Profile Page
 */

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { waterProfileEntity } from "@/entities/water-profile";

export default function NewWaterProfilePage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={waterProfileEntity}
      basePath="/settings/water-profiles"
    />
  );
}
