"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { enumValueEntity } from "@/entities/enum-value";

export default function NewEnumValuePage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={enumValueEntity}
      basePath="/settings/status-options"
    />
  );
}
