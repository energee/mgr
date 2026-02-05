"use client";

/**
 * Vessel Detail Page
 */

import { use } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { vesselEntity } from "@/entities/vessel";

export default function VesselDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={vesselEntity}
      id={id}
      basePath="/production/vessels"
    />
  );
}
