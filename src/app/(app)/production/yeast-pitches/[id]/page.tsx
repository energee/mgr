"use client";

/**
 * Yeast Pitch Detail Page
 *
 * View yeast pitch details including strain, viability, lineage, and usage.
 * The harvest action has moved to the batch detail page (batch-centric model).
 */

import { use } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { yeastPitchEntity } from "@/entities/yeast-pitch";
import { YeastLineageDisplay } from "@/components/domain/yeast-lineage-display";

interface YeastPitchDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function YeastPitchDetailPage({ params }: YeastPitchDetailPageProps) {
  const { id } = use(params);

  return (
    <>
      <EntityDetailUnifiedWithErrorBoundary
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entity={yeastPitchEntity as any}
        id={id}
        basePath="/production/yeast-pitches"
      />

      {/* Lineage display */}
      <div className="mt-6">
        <YeastLineageDisplay pitchId={id} />
      </div>
    </>
  );
}
