"use client";

/**
 * New Water Profile Page
 */

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { waterProfileEntity } from "@/entities/water-profile";

export default function NewWaterProfilePage() {
  return (
    <EntityDetailPage
      entity={waterProfileEntity}
      basePath="/settings/water-profiles"
    />
  );
}
