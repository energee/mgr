"use client";

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { enumValueEntity } from "@/entities/enum-value";

export default function NewEnumValuePage() {
  return (
    <EntityDetailPage
      entity={enumValueEntity}
      basePath="/settings/status-options"
    />
  );
}
