"use client";

/**
 * Water Profile Detail Page
 */

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { waterProfileEntity } from "@/entities/water-profile";

export default function WaterProfileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <EntityDetailPage
      entity={waterProfileEntity}
      id={id}
      basePath="/settings/water-profiles"
    />
  );
}
