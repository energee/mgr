"use client";

/**
 * Batch Detail Page
 *
 * Custom batch detail that wraps EntityDetail with batch-specific
 * action handling (e.g., start fermentation dialog).
 */

import { use, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { EntityDetail } from "@/components/universal/entity-detail";
import { batchEntity } from "@/entities/batch";
import { StartFermentationDialog } from "@/components/domain/start-fermentation-dialog";

export default function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [showStartFermentation, setShowStartFermentation] = useState(false);
  const queryClient = useQueryClient();
  const supabase = createClient();

  // Fetch batch data for the dialog
  const { data: batch } = useQuery({
    queryKey: ["batches", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("batches")
        .select("id, batch_number, name, status, volume_bbl")
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
    return false; // Let EntityDetail handle normally
  }, []);

  const handleDialogSuccess = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["batches", id] });
  }, [queryClient, id]);

  return (
    <>
      <EntityDetail
        entity={batchEntity}
        id={id}
        basePath="/production/batches"
        onAction={handleAction}
      />

      {batch && (
        <StartFermentationDialog
          batchId={batch.id}
          batchNumber={batch.batch_number}
          plannedVolume={batch.volume_bbl}
          open={showStartFermentation}
          onOpenChange={setShowStartFermentation}
          onSuccess={handleDialogSuccess}
        />
      )}
    </>
  );
}
