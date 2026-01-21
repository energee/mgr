"use client";

/**
 * Yeast Pitch Create Page
 *
 * Record a new yeast pitch (purchase or harvest).
 */

import { EntityForm } from "@/components/universal/entity-form";
import { yeastPitchEntity } from "@/entities/yeast-pitch";

export default function YeastPitchNewPage() {
  return (
    <EntityForm
      entity={yeastPitchEntity}
      basePath="/production/yeast-pitches"
    />
  );
}
