"use client";

/**
 * Batches List Page
 *
 * Displays all batches using the universal EntityList component.
 * Includes custom action handling for cancel/archive dialogs.
 */

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EntityList } from "@/components/universal/entity-list";
import { batchEntity } from "@/entities/batch";
import { batchKeys } from "@/lib/query-keys";
import { BatchCancellationDialog } from "@/components/domain/batch-cancellation-dialog";

interface BatchRecord {
  id: string;
  batch_number: string;
  name: string | null;
  status: string | null;
  volume_bbl: number | null;
  current_vessel_name: string | null;
}

export default function BatchesPage() {
  const queryClient = useQueryClient();
  const [selectedBatch, setSelectedBatch] = useState<BatchRecord | null>(null);
  const [showTerminationDialog, setShowTerminationDialog] = useState(false);

  // Custom action handler for batch-specific actions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleAction = useCallback((actionName: string, record: any) => {
    // Both cancel and archive use the same dialog (it adapts based on status)
    if (actionName === "cancel" || actionName === "archive") {
      setSelectedBatch(record as BatchRecord);
      setShowTerminationDialog(true);
      return true; // Indicates action was handled
    }
    return false; // Let EntityList handle normally
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
        <BatchCancellationDialog
          batchId={selectedBatch.id}
          batchNumber={selectedBatch.batch_number}
          batchName={selectedBatch.name}
          currentStatus={selectedBatch.status}
          currentVolume={selectedBatch.volume_bbl}
          vesselName={selectedBatch.current_vessel_name}
          open={showTerminationDialog}
          onOpenChange={setShowTerminationDialog}
          onSuccess={handleDialogSuccess}
        />
      )}
    </>
  );
}
