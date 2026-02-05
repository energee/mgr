"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { packageTypeEntity } from "@/entities/package-type";

export default function NewPackageTypePage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={packageTypeEntity}
      basePath="/settings/formats"
    />
  );
}
