"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { packagingSessionEntity } from "@/entities/packaging-session";

export default function NewPackagingSessionPage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={packagingSessionEntity}
      basePath="/production/packaging"
    />
  );
}
