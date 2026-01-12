"use client";

/**
 * Packaging Session Detail Page
 */

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { packagingSessionEntity } from "@/entities/packaging-session";

export default function PackagingSessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <EntityDetail
      entity={packagingSessionEntity}
      id={id}
      basePath="/production/packaging"
    />
  );
}
