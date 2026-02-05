"use client";

import { useState } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { packagingSessionEntity } from "@/entities/packaging-session";
import { usePrefillStore } from "@/stores/prefill-store";

export default function NewPackagingSessionPage() {
  const [defaultValues] = useState(() => {
    const { prefillData } = usePrefillStore.getState().consume();
    return prefillData ?? undefined;
  });

  return (
    <EntityForm
      entity={packagingSessionEntity}
      basePath="/production/packaging"
      defaultValues={defaultValues}
    />
  );
}
