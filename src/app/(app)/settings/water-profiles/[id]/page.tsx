"use client";

/**
 * Water Profile Detail Page
 */

import { use } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { waterProfileEntity } from "@/entities/water-profile";

export default function WaterProfileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={waterProfileEntity}
      id={id}
      basePath="/settings/water-profiles"
    />
  );
}
