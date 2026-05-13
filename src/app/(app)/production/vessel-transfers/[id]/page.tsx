"use client";

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { vesselTransferEntity } from "@/entities/vessel-transfer";

export default function VesselTransferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <EntityDetailPage
      entity={vesselTransferEntity}
      id={id}
      basePath="/production/vessel-transfers"
    />
  );
}
