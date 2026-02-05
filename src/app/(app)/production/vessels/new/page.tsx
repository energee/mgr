"use client";

/**
 * New Vessel Page
 */

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { vesselEntity } from "@/entities/vessel";

export default function NewVesselPage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={vesselEntity}
      basePath="/production/vessels"
    />
  );
}
