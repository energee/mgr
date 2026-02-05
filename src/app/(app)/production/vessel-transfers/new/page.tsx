"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { vesselTransferEntity } from "@/entities/vessel-transfer";

export default function NewVesselTransferPage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={vesselTransferEntity}
      basePath="/production/vessel-transfers"
    />
  );
}
