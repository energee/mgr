"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { locationTransferEntity } from "@/entities/location-transfer";

export default function NewTransferPage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={locationTransferEntity}
      basePath="/inventory/transfers"
    />
  );
}
