"use client";

import { useState } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { packagingSessionEntity } from "@/entities/packaging-session";
import { usePrefillStore } from "@/stores/prefill-store";

export default function NewPackagingSessionPage() {
  const [defaultValues] = useState(() => {
    const { prefillData } = usePrefillStore.getState().consume();
    return prefillData ?? undefined;
  });

  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={packagingSessionEntity}
      basePath="/production/packaging"
      defaultValues={defaultValues}
    />
  );
}
