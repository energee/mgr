"use client";

/**
 * Batch Detail Page
 *
 * Custom batch detail that wraps EntityDetail with batch-specific
 * action handling (e.g., start fermentation dialog, cancellation dialog).
 */

import { use, useState, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { batchEntity } from "@/entities/batch";
import { StartFermentationDialog } from "@/components/domain/start-fermentation-dialog";
import { BatchCancellationDialog } from "@/components/domain/batch-cancellation-dialog";
import { BatchBlendDialog } from "@/components/domain/batch-blend-dialog";
import { VesselTransferDialog } from "@/components/domain/vessel-transfer-dialog";
import { StartBrewDayDialog } from "@/components/domain/start-brew-day-dialog";
import { NextStepBanner } from "@/components/domain/next-step-banner";
import { BrewJourneyBreadcrumb } from "@/components/domain/brew-journey-breadcrumb";
import { batchKeys, recipeKeys } from "@/lib/query-keys";
import { usePrefillStore } from "@/stores/prefill-store";

export default function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  // Consume prefill store once on initial render to auto-open dialogs from AI
  const [prefillDialog] = useState(() => {
    const { openDialog } = usePrefillStore.getState().consume();
    return openDialog;
  });
  const [showStartFermentation, setShowStartFermentation] = useState(
    prefillDialog === "start_fermentation"
  );
  const [showCancellation, setShowCancellation] = useState(
    prefillDialog === "cancel" || prefillDialog === "archive"
  );
  const [showBlend, setShowBlend] = useState(prefillDialog === "blend");
  const [showTransfer, setShowTransfer] = useState(
    prefillDialog === "transfer_vessel"
  );
  const [showStartBrewDay, setShowStartBrewDay] = useState(false);

  const queryClient = useQueryClient();
  const supabase = createClient();
  const router = useRouter();

  // Fetch batch data for the dialogs (use view to get vessel info)
  const { data: batch } = useQuery({
    queryKey: batchKeys.detail(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("batches_with_brew_info")
        .select("id, batch_number, name, status, volume_bbl, current_vessel_id, current_vessel_name, recipe_id")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Fetch linked brew logs for banner logic and breadcrumb
  // Uses a separate key from BrewLogLinker to avoid cache shape conflicts
  const { data: linkedBrewLogs } = useQuery({
    queryKey: batchKeys.brewLogLinks(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brew_log_batches")
        .select("brew_log_id, brew_log:brew_logs(brew_number)")
        .eq("batch_id", id);
      if (error) throw error;
      return (data ?? []) as Array<{
        brew_log_id: string;
        brew_log: { brew_number: string } | null;
      }>;
    },
  });

  // Fetch recipe info for StartBrewDayDialog
  const { data: recipe } = useQuery({
    queryKey: recipeKeys.detail(batch?.recipe_id ?? ""),
    queryFn: async () => {
      if (!batch?.recipe_id) return null;
      const { data, error } = await supabase
        .from("recipes")
        .select("id, name")
        .eq("id", batch.recipe_id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!batch?.recipe_id,
  });

  // Breadcrumb: Recipe -> Brew Log -> Batch
  const breadcrumbSegments = useMemo(() => {
    const segments: { label: string; href?: string }[] = [];
    if (recipe) {
      segments.push({ label: recipe.name, href: `/production/recipes/${recipe.id}` });
    }
    if (linkedBrewLogs?.length) {
      const primary = linkedBrewLogs[0];
      const brewNumber = primary.brew_log?.brew_number ?? "Brew Log";
      segments.push({ label: brewNumber, href: `/production/brew-logs/${primary.brew_log_id}` });
    }
    segments.push({ label: batch?.batch_number ?? "Batch" }); // current page, no href
    return segments;
  }, [recipe, linkedBrewLogs, batch]);

  // Banner config based on batch status and brew log linkage
  const bannerConfig = useMemo(() => {
    if (!batch) return null;

    if (batch.status === "planned" && (!linkedBrewLogs?.length)) {
      return {
        message: "This batch needs a brew. Start a brew day or link an existing brew log.",
        variant: "info" as const,
        actions: [
          { label: "Start Brew Day", onClick: () => setShowStartBrewDay(true) },
        ],
      };
    }
    if (batch.status === "planned" && linkedBrewLogs?.length) {
      return {
        message: "Brew is linked. Start fermentation when ready.",
        variant: "info" as const,
        actions: [{ label: "Start Fermentation", onClick: () => setShowStartFermentation(true) }],
      };
    }
    if (batch.status === "fermenting") {
      return {
        message: "Track fermentation progress with readings and additions.",
        variant: "default" as const,
        actions: [
          { label: "Readings", href: `/production/batches/${id}/readings` },
          { label: "Additions", href: `/production/batches/${id}/additions` },
        ],
      };
    }
    return null;
  }, [batch, linkedBrewLogs, id]);

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
    if (actionName === "transfer_vessel") {
      setShowTransfer(true);
      return true;
    }
    return false; // Let EntityDetail handle normally
  }, []);

  const handleDialogSuccess = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: batchKeys.detail(id) });
  }, [queryClient, id]);

  return (
    <div className="space-y-4">
      <BrewJourneyBreadcrumb segments={breadcrumbSegments} />

      {bannerConfig && (
        <NextStepBanner
          message={bannerConfig.message}
          actions={bannerConfig.actions}
          variant={bannerConfig.variant}
        />
      )}

      <EntityDetailUnifiedWithErrorBoundary
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

          <VesselTransferDialog
            batchId={batch.id}
            batchNumber={batch.batch_number}
            fromVesselId={batch.current_vessel_id}
            fromVesselName={batch.current_vessel_name}
            currentVolume={batch.volume_bbl}
            open={showTransfer}
            onOpenChange={setShowTransfer}
            onSuccess={handleDialogSuccess}
          />
        </>
      )}

      {recipe && (
        <StartBrewDayDialog
          recipeId={recipe.id}
          recipeName={recipe.name}
          existingBatchId={id}
          existingBatchVolume={batch?.volume_bbl ?? undefined}
          open={showStartBrewDay}
          onOpenChange={setShowStartBrewDay}
          onSuccess={(brewLogId) => {
            queryClient.invalidateQueries({ queryKey: batchKeys.brewLogLinks(id) });
            queryClient.invalidateQueries({ queryKey: batchKeys.brewLogs(id) });
            queryClient.invalidateQueries({ queryKey: batchKeys.detail(id) });
            router.push(`/production/brew-logs/${brewLogId}`);
          }}
        />
      )}
    </div>
  );
}
