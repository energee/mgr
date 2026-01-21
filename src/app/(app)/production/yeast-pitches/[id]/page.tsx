"use client";

/**
 * Yeast Pitch Detail Page
 *
 * View yeast pitch details including strain, viability, lineage, and usage.
 */

import { EntityDetail } from "@/components/universal/entity-detail";
import { yeastPitchEntity } from "@/entities/yeast-pitch";

interface YeastPitchDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function YeastPitchDetailPage({ params }: YeastPitchDetailPageProps) {
  const { id } = await params;

  return (
    <EntityDetail
      entity={yeastPitchEntity}
      id={id}
      basePath="/production/yeast-pitches"
    />
  );
}
