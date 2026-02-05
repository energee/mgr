"use client";

/**
 * Batch Detail Page
 *
 * Custom batch detail that wraps EntityDetail with batch-specific
 * action handling (e.g., start fermentation dialog, cancellation dialog).
 */

import { use, useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { EntityDetail } from "@/components/universal/entity-detail";
import { batchEntity } from "@/entities/batch";
import { StartFermentationDialog } from "@/components/domain/start-fermentation-dialog";
import { BatchCancellationDialog } from "@/components/domain/batch-cancellation-dialog";
import { BatchBlendDialog } from "@/components/domain/batch-blend-dialog";
import { batchKeys } from "@/lib/query-keys";
import { usePrefillStore } from "@/stores/prefill-store";

export default function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [showStartFermentation, setShowStartFermentation] = useState(false);
  const [showCancellation, setShowCancellation] = useState(false);
  const [showBlend, setShowBlend] = useState(false);
  const consumed = useRef(false);
  const consume = usePrefillStore((s) => s.consume);

  useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;
    const { openDialog } = consume();
    if (!openDialog) return;

    if (openDialog === "start_fermentation") {
      setShowStartFermentation(true);
    } else if (openDialog === "cancel" || openDialog === "archive") {
      setShowCancellation(true);
    } else if (openDialog === "blend") {
      setShowBlend(true);
    }
  }, [consume]);

  const queryClient = useQueryClient();
  const supabase = createClient();

  // Fetch batch data for the dialogs (use view to get vessel info)
  const { data: batch } = useQuery({
    queryKey: batchKeys.detail(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("batches_with_brew_info")
        .select("id, batch_number, name, status, volume_bbl, current_vessel_name")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Custom action handler for batch-specific actions
  const handleAction = useCallback((actionName: string) => {
    if (actionName === "start_fermentation") {
      setShowStartFermentation(true);
      return true; // Indicates action was handled
    }
    // Both cancel and archive use the same dialog (it adapts based on status)
    if (actionName === "cancel" || actionName === "archive") {
      setShowCancellation(true);
      return true; // Indicates action was handled
    }
    if (actionName === "blend") {
      setShowBlend(true);
      return true; // Indicates action was handled
    }
    return false; // Let EntityDetail handle normally
  }, []);

  const handleDialogSuccess = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: batchKeys.detail(id) });
  }, [queryClient, id]);

  return (
    <>
      <EntityDetail
        entity={batchEntity}
        id={id}
        basePath="/production/batches"
        onAction={handleAction}
      />

      {batch && batch.id && batch.batch_number && (
        <>
          <StartFermentationDialog
            batchId={batch.id}
            batchNumber={batch.batch_number}
            plannedVolume={batch.volume_bbl}
            open={showStartFermentation}
            onOpenChange={setShowStartFermentation}
            onSuccess={handleDialogSuccess}
          />

          <BatchCancellationDialog
            batchId={batch.id}
            batchNumber={batch.batch_number}
            batchName={batch.name}
            currentStatus={batch.status}
            currentVolume={batch.volume_bbl}
            vesselName={batch.current_vessel_name}
            open={showCancellation}
            onOpenChange={setShowCancellation}
            onSuccess={handleDialogSuccess}
          />

          <BatchBlendDialog
            batchId={batch.id}
            batchNumber={batch.batch_number}
            batchName={batch.name}
            open={showBlend}
            onOpenChange={setShowBlend}
            onSuccess={handleDialogSuccess}
          />
        </>
      )}
    </>
  );
}
