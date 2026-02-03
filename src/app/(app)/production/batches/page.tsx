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
import type { Database } from "@/types/supabase";

type Batch = Database["public"]["Tables"]["batches"]["Row"];

export default function BatchesPage() {
  const queryClient = useQueryClient();
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  const [showTerminationDialog, setShowTerminationDialog] = useState(false);

  // Custom action handler for batch-specific actions
  const handleAction = useCallback((actionName: string, record: Batch) => {
    // Both cancel and archive use the same dialog (it adapts based on status)
    if (actionName === "cancel" || actionName === "archive") {
      setSelectedBatch(record);
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
      <EntityList<Batch>
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
          open={showTerminationDialog}
          onOpenChange={setShowTerminationDialog}
          onSuccess={handleDialogSuccess}
        />
      )}
    </>
  );
}
