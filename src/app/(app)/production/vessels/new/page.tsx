"use client";

/**
 * New Vessel Page
 */

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { vesselEntity } from "@/entities/vessel";

export default function NewVesselPage() {
  return (
    <EntityDetailPage
      entity={vesselEntity}
      basePath="/production/vessels"
    />
  );
}
