"use client";

/**
 * Batches List Page
 *
 * Displays all batches using the universal EntityList component.
 * Includes custom action handling for cancel/archive dialogs and
 * start brew day dialog. Start Brew Day chains into the
 * BrewConsumptionDialog (FIFO ingredient allocations) when the batch
 * has a recipe, mirroring the batch detail page.
 */

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { EntityList } from "@/components/universal/entity-list";
import { batchEntity } from "@/entities/batch";
import { batchKeys } from "@/lib/query-keys";
import { BatchCancellationDialog } from "@/components/domain/batch/batch-cancellation-dialog";
import { StartBrewDayDialog } from "@/components/domain/brew/start-brew-day-dialog";
import { BrewConsumptionDialog } from "@/components/domain/brew/brew-consumption-dialog";

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
  // Brew log created, waiting for ingredient consumption confirmation (9.1)
  const [pendingBrewLogId, setPendingBrewLogId] = useState<string | null>(null);

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
    return false;
  }, []);

  const handleDialogSuccess = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: batchKeys.all() });
  }, [queryClient]);

  /** Continue to the brew log after consumption is confirmed/skipped. */
  const handleConsumptionDone = useCallback(() => {
    if (pendingBrewLogId) {
      router.push(`/production/brew-logs/${pendingBrewLogId}`);
      setPendingBrewLogId(null);
    }
  }, [pendingBrewLogId, router]);

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
              // With a recipe, confirm ingredient consumption before navigating
              if (selectedBatch.recipe_id) {
                setPendingBrewLogId(brewLogId);
              } else {
                router.push(`/production/brew-logs/${brewLogId}`);
              }
            }}
          />

          {selectedBatch.recipe_id && (
            <BrewConsumptionDialog
              batchId={selectedBatch.id}
              batchNumber={selectedBatch.batch_code}
              recipeId={selectedBatch.recipe_id}
              batchVolumeBbl={selectedBatch.volume_bbl}
              open={pendingBrewLogId !== null}
              // Navigation happens in onDone (confirm and skip both call it)
              onOpenChange={(o) => {
                if (o) return;
              }}
              onDone={handleConsumptionDone}
            />
          )}
        </>
      )}
    </>
  );
}
