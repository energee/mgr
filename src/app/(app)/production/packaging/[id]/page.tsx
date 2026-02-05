"use client";

import { use } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { packagingSessionEntity } from "@/entities/packaging-session";

export default function PackagingSessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={packagingSessionEntity}
      id={id}
      basePath="/production/packaging"
    />
  );
}
