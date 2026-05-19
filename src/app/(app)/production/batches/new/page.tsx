"use client";

import { useState } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { batchEntity } from "@/entities/batch";
import { usePrefillStore } from "@/contexts/prefill-store";

export default function NewBatchPage() {
  const [defaultValues] = useState(() => {
    const { prefillData } = usePrefillStore.getState().consume();
    return prefillData ?? undefined;
  });

  return (
    <EntityDetailPage
      entity={batchEntity}
      basePath="/production/batches"
      defaultValues={defaultValues}
    />
  );
}
