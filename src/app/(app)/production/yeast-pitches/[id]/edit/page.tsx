"use client";

/**
 * Yeast Pitch Edit Page
 *
 * Edit existing yeast pitch details.
 */

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { yeastPitchEntity } from "@/entities/yeast-pitch";

interface YeastPitchEditPageProps {
  params: Promise<{ id: string }>;
}

export default function YeastPitchEditPage({ params }: YeastPitchEditPageProps) {
  const { id } = use(params);

  return (
    <EntityForm
      entity={yeastPitchEntity}
      id={id}
      basePath="/production/yeast-pitches"
    />
  );
}
