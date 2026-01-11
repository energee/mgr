"use client";

/**
 * Vessel Detail Page
 */

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { vesselEntity } from "@/entities/vessel";

export default function VesselDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <EntityDetail
      entity={vesselEntity}
      id={id}
      basePath="/production/vessels"
    />
  );
}
