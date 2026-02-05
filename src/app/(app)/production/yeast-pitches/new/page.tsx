"use client";

/**
 * Yeast Pitch Create Page
 *
 * Record a new yeast pitch (purchase or harvest).
 */

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { yeastPitchEntity } from "@/entities/yeast-pitch";

export default function YeastPitchNewPage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={yeastPitchEntity}
      basePath="/production/yeast-pitches"
    />
  );
}
