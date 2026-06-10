"use client";

/**
 * Batches List Page
 *
 * Displays all batches using the universal EntityList component.
 * Includes custom action handling for cancel/archive dialogs and
 * start brew day dialog. Start Brew Day chains into the
 * BrewConsumptionDialog (FIFO ingredient allocations) when the batch
 * has a recipe, via useBrewConsumptionFlow (shared with the batch
 * detail page).
 */

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EntityList } from "@/components/universal/entity-list";
import { batchEntity } from "@/entities/batch";
import { batchKeys } from "@/lib/query-keys";
import { BatchCancellationDialog } from "@/components/domain/batch/batch-cancellation-dialog";
import { StartBrewDayDialog } from "@/components/domain/brew/start-brew-day-dialog";
import { useBrewConsumptionFlow } from "@/components/domain/brew/use-brew-consumption-flow";

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
  const [selectedBatch, setSelectedBatch] = useState<BatchRecord | null>(null);
  const [showTerminationDialog, setShowTerminationDialog] = useState(false);
  const [showStartBrewDay, setShowStartBrewDay] = useState(false);
  // Brew log → consumption confirmation → navigate (shared flow, 9.1)
  const { handleBrewLogCreated, consumptionDialog } = useBrewConsumptionFlow(selectedBatch);

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
              handleBrewLogCreated(brewLogId);
            }}
          />

          {consumptionDialog}
        </>
      )}
    </>
  );
}
