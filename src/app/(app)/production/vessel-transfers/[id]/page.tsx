"use client";

import { use } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { vesselTransferEntity } from "@/entities/vessel-transfer";

export default function VesselTransferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={vesselTransferEntity}
      id={id}
      basePath="/production/vessel-transfers"
    />
  );
}
