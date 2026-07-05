"use client";

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { packagingSessionEntity } from "@/entities/packaging-session";
import { usePrefillHydration } from "@/hooks/use-prefill-hydration";

export default function NewPackagingSessionPage() {
  // Prefill lives in sessionStorage (client-only), so it must be consumed
  // after hydration; render nothing until it is known (SENTRY-7477285482).
  const { ready, defaultValues } = usePrefillHydration();

  if (!ready) return null;

  return (
    <EntityDetailPage
      entity={packagingSessionEntity}
      basePath="/production/packaging"
      defaultValues={defaultValues}
    />
  );
}
