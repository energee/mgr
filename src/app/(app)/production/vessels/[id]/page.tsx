"use client";

/**
 * Vessel Detail Page
 */

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { vesselEntity } from "@/entities/vessel";

export default function VesselDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <EntityDetailPage
      entity={vesselEntity}
      id={id}
      basePath="/production/vessels"
    />
  );
}
