"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { locationEntity } from "@/entities/location";

export default function NewLocationPage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={locationEntity}
      basePath="/settings/locations"
    />
  );
}
