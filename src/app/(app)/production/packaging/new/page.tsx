"use client";

import { useState } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { packagingSessionEntity } from "@/entities/packaging-session";
import { usePrefillStore } from "@/stores/prefill-store";

export default function NewPackagingSessionPage() {
  const [defaultValues] = useState(() => {
    const { prefillData } = usePrefillStore.getState().consume();
    return prefillData ?? undefined;
  });

  return (
    <EntityDetailPage
      entity={packagingSessionEntity}
      basePath="/production/packaging"
      defaultValues={defaultValues}
    />
  );
}
