"use client";

/**
 * Water Addition Profile Detail Page
 */

import { use } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { waterAdditionProfileEntity } from "@/entities/water-addition-profile";

export default function WaterAdditionProfileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={waterAdditionProfileEntity}
      id={id}
      basePath="/settings/water-profiles/additions"
    />
  );
}
