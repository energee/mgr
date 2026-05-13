"use client";

/**
 * Yeast Pitch Create Page
 *
 * Record a new yeast pitch (purchase or harvest).
 */

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { yeastPitchEntity } from "@/entities/yeast-pitch";

export default function YeastPitchNewPage() {
  return (
    <EntityDetailPage
      entity={yeastPitchEntity}
      basePath="/production/yeast-pitches"
    />
  );
}
