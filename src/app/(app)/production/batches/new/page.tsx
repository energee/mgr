"use client";

import { useState } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { batchEntity } from "@/entities/batch";
import { usePrefillStore } from "@/stores/prefill-store";

export default function NewBatchPage() {
  const [defaultValues] = useState(() => {
    const { prefillData } = usePrefillStore.getState();
    if (prefillData) {
      usePrefillStore.getState().consume();
    }
    return prefillData ?? undefined;
  });

  return (
    <EntityForm
      entity={batchEntity}
      basePath="/production/batches"
      defaultValues={defaultValues}
    />
  );
}
