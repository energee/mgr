"use client";

/**
 * Yeast Pitch Detail Page
 *
 * View yeast pitch details including strain, viability, lineage, and usage.
 * Handles custom actions:
 * - Record Cell Count: opens dialog to update viability from a lab measurement
 * - Pitch to Batch: redirects users to the batch detail page (batch-centric model)
 * - Discard: handled by the universal entity detail (state transition)
 */

import { use, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { yeastPitchEntity } from "@/entities/yeast-pitch";
import { YeastLineageDisplay } from "@/components/domain/yeast-lineage-display";
import { RecordCellCountDialog } from "@/components/domain/record-cell-count-dialog";
import { yeastKeys } from "@/lib/query-keys";

interface YeastPitchDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function YeastPitchDetailPage({ params }: YeastPitchDetailPageProps) {
  const { id } = use(params);
  const queryClient = useQueryClient();

  const [showCellCountDialog, setShowCellCountDialog] = useState(false);
  const [currentPitchData, setCurrentPitchData] = useState<{
    id: string;
    strain_name?: string;
    source_type?: string;
  } | null>(null);

  // Handle custom actions from the entity detail action bar.
  // "pitch_to_batch" is intentionally not handled here -- users pitch
  // yeast from the batch detail page (batch-centric workflow).
  // "discard" uses a standard state transition, handled by the universal component.
  const handleAction = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (actionName: string, data: any): boolean => {
      if (actionName === "record_cell_count") {
        setCurrentPitchData({
          id: data.id,
          strain_name: data.strain_name,
          source_type: data.source_type,
        });
        setShowCellCountDialog(true);
        return true;
      }
      return false;
    },
    []
  );

  return (
    <>
      <EntityDetailUnifiedWithErrorBoundary
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entity={yeastPitchEntity as any}
        id={id}
        basePath="/production/yeast-pitches"
        onAction={handleAction}
      />

      {/* Lineage display */}
      <div className="mt-6">
        <YeastLineageDisplay pitchId={id} />
      </div>

      {/* Record Cell Count Dialog */}
      {currentPitchData && (
        <RecordCellCountDialog
          open={showCellCountDialog}
          onOpenChange={setShowCellCountDialog}
          pitchId={currentPitchData.id}
          pitchName={currentPitchData.strain_name || "this pitch"}
          sourceType={
            currentPitchData.source_type === "harvest" ? "harvest" : "purchase"
          }
          onSuccess={() => {
            queryClient.invalidateQueries({
              queryKey: yeastKeys.detail(id),
            });
          }}
        />
      )}
    </>
  );
}
