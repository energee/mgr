"use client";

import { useState } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { batchEntity } from "@/entities/batch";
import { usePrefillStore } from "@/stores/prefill-store";

export default function NewBatchPage() {
  const [defaultValues] = useState(() => {
    const { prefillData } = usePrefillStore.getState().consume();
    return prefillData ?? undefined;
  });

  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={batchEntity}
      basePath="/production/batches"
      defaultValues={defaultValues}
    />
  );
}
