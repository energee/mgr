"use client";

/**
 * Vessel Transfer Detail Page
 */

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { vesselTransferEntity } from "@/entities/vessel-transfer";

export default function VesselTransferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <EntityDetail
      entity={vesselTransferEntity}
      id={id}
      basePath="/production/vessel-transfers"
    />
  );
}
