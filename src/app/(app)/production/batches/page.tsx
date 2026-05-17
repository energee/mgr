"use client";

/**
 * Batches List Page
 *
 * Displays all batches using the universal EntityList component.
 * Includes custom action handling for cancel/archive dialogs and
 * start brew day dialog.
 */

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { EntityList } from "@/components/universal/entity-list";
import { batchEntity } from "@/entities/batch";
import { batchKeys } from "@/lib/query-keys";
import { BatchCancellationDialog } from "@/components/domain/batch-cancellation-dialog";
import { StartBrewDayDialog } from "@/components/domain/start-brew-day-dialog";
import { BatchDuplicateDialog } from "@/components/domain/batch-duplicate-dialog";

type BatchRecord = {
  id: string;
  batch_code: string;
  name: string | null;
  status: string | null;
  volume_bbl: number | null;
  current_vessel_name: string | null;
  recipe_id: string | null;
}

export default function BatchesPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [selectedBatch, setSelectedBatch] = useState<BatchRecord | null>(null);
  const [showTerminationDialog, setShowTerminationDialog] = useState(false);
  const [showStartBrewDay, setShowStartBrewDay] = useState(false);
  const [showDuplicate, setShowDuplicate] = useState(false);

  // Custom action handler for batch-specific actions
  const handleAction = useCallback((actionName: string, record: Record<string, unknown>) => {
    if (actionName === "cancel" || actionName === "archive") {
      setSelectedBatch(record as unknown as BatchRecord);
      setShowTerminationDialog(true);
      return true;
    }
    if (actionName === "start_brew_day") {
      setSelectedBatch(record as unknown as BatchRecord);
      setShowStartBrewDay(true);
      return true;
    }
    if (actionName === "duplicate") {
      setSelectedBatch(record as unknown as BatchRecord);
      setShowDuplicate(true);
      return true;
    }
    return false;
  }, []);

  const handleDialogSuccess = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: batchKeys.all() });
  }, [queryClient]);

  return (
    <>
      <EntityList
        entity={batchEntity}
        basePath="/production/batches"
        onAction={handleAction}
      />

      {selectedBatch && (
        <>
          <BatchCancellationDialog
            batchId={selectedBatch.id}
            batchNumber={selectedBatch.batch_code}
            batchName={selectedBatch.name}
            currentStatus={selectedBatch.status}
            currentVolume={selectedBatch.volume_bbl}
            vesselName={selectedBatch.current_vessel_name}
            open={showTerminationDialog}
            onOpenChange={setShowTerminationDialog}
            onSuccess={handleDialogSuccess}
          />

          <StartBrewDayDialog
            batchId={selectedBatch.id}
            batchNumber={selectedBatch.batch_code}
            batchName={selectedBatch.name}
            recipeName={null}
            volumeBbl={selectedBatch.volume_bbl}
            open={showStartBrewDay}
            onOpenChange={setShowStartBrewDay}
            onSuccess={(brewLogId) => {
              handleDialogSuccess();
              router.push(`/production/brew-logs/${brewLogId}`);
            }}
          />

          <BatchDuplicateDialog
            source={{
              id: selectedBatch.id,
              batch_code: selectedBatch.batch_code,
              name: selectedBatch.name,
              recipe_id: selectedBatch.recipe_id,
              volume_bbl: selectedBatch.volume_bbl,
            }}
            open={showDuplicate}
            onOpenChange={setShowDuplicate}
            onSuccess={(newId) => router.push(`/production/batches/${newId}`)}
          />
        </>
      )}
    </>
  );
}
