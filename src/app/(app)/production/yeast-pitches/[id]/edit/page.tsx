"use client";

/**
 * Yeast Pitch Edit Page
 *
 * Edit existing yeast pitch details.
 */

import { EntityForm } from "@/components/universal/entity-form";
import { yeastPitchEntity } from "@/entities/yeast-pitch";

interface YeastPitchEditPageProps {
  params: Promise<{ id: string }>;
}

export default async function YeastPitchEditPage({ params }: YeastPitchEditPageProps) {
  const { id } = await params;

  return (
    <EntityForm
      entity={yeastPitchEntity}
      id={id}
      basePath="/production/yeast-pitches"
    />
  );
}
