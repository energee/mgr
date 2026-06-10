"use client";

/**
 * Batch Detail Page
 *
 * Custom batch detail that wraps EntityDetailUnified with batch-specific
 * action handling: Transfer, Pitch Yeast, Harvest Yeast, Blend, Start
 * Packaging, and Cancel/Archive dialogs. State transitions (planned ->
 * fermenting, fermenting -> conditioning) are suggested via toast after
 * actions rather than being direct state-change buttons.
 *
 * Inventory loop wiring (audit Batch 9):
 * - Start Brew Day chains into BrewConsumptionDialog, which plans FIFO
 *   ingredient allocations (inventory_lot -> batch, status planned).
 * - The Complete action is intercepted so those planned allocations are
 *   flipped to completed alongside the status change.
 */

import { use, useRef, useState, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { batchEntity } from "@/entities/batch";
import { PitchYeastDialog } from "@/components/domain/yeast/pitch-yeast-dialog";
import { YeastHarvestDialog } from "@/components/domain/yeast/yeast-harvest-dialog";
import { BatchCancellationDialog } from "@/components/domain/batch/batch-cancellation-dialog";
import { BatchBlendDialog } from "@/components/domain/batch/batch-blend-dialog";
import { VesselTransferDialog } from "@/components/domain/batch/vessel-transfer-dialog";
import { StartBrewDayDialog } from "@/components/domain/brew/start-brew-day-dialog";
import { BrewConsumptionDialog } from "@/components/domain/brew/brew-consumption-dialog";
import { completeBatchConsumption } from "@/services/consumption-service";
import { formatServiceError } from "@/services/types";
import { PackagingBatchDialog } from "@/components/domain/packaging/packaging-batch-dialog";
import { AddToPackagingSessionDialog } from "@/components/domain/packaging/add-to-packaging-session-dialog";
import { BatchPackagingHistory } from "@/components/domain/batch/batch-packaging-history";
import { NextStepBanner } from "@/components/domain/shared/next-step-banner";
import { EntityBreadcrumb } from "@/components/universal/entity-breadcrumb";
import { batchKeys, recipeKeys, packagingKeys } from "@/lib/query-keys";
import { usePrefillStore } from "@/contexts/prefill-store";

export default function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  // useRef instead of useState lazy-init: React strict mode fires initializers twice,
  // which would double-consume the store. This ref-guard runs exactly once.
  const prefillRef = useRef<string | null | undefined>(undefined);
  if (prefillRef.current === undefined) {
    prefillRef.current = usePrefillStore.getState().consume().openDialog ?? null;
  }
  const prefillDialog = prefillRef.current;
  const [showPitchYeast, setShowPitchYeast] = useState(
    prefillDialog === "pitch_yeast"
  );
  const [showHarvestYeast, setShowHarvestYeast] = useState(
    prefillDialog === "harvest_yeast"
  );
  const [showCancellation, setShowCancellation] = useState(
    prefillDialog === "cancel" || prefillDialog === "archive"
  );
  const [showBlend, setShowBlend] = useState(prefillDialog === "blend");
  const [showTransfer, setShowTransfer] = useState(
    prefillDialog === "transfer" || prefillDialog === "transfer_vessel"
  );
  const [showStartBrewDay, setShowStartBrewDay] = useState(false);
  const [showStartPackaging, setShowStartPackaging] = useState(false);
  const [showAddToSession, setShowAddToSession] = useState(false);
  // Brew-day ingredient consumption (9.1): after a brew log is created we
  // hold its id and show the consumption confirmation dialog before navigating.
  const [pendingBrewLogId, setPendingBrewLogId] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const supabase = createClient();
  const router = useRouter();

  // Fetch batch data for the dialogs (use view to get vessel info)
  // The view includes target_og via b.* but generated types are stale; use type extension
  type BatchDetail = {
    id: string;
    batch_code: string;
    name: string;
    status: string;
    volume_bbl: number | null;
    target_og: number | null;
    current_vessel_id: string | null;
    current_vessel_name: string | null;
    recipe_id: string | null;
  };
  const { data: batch } = useQuery({
    queryKey: batchKeys.detail(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("batches_with_brew_info")
        .select("id, batch_code, name, status, volume_bbl, current_vessel_id, current_vessel_name, recipe_id")
        .eq("id", id)
        .single();
      if (error) throw error;
      // target_og is available in the view (via b.*) but not in generated types yet
      // Runtime-validate required fields before casting
      if (!data || typeof data.id !== "string") {
        throw new Error("Batch detail query returned invalid data");
      }
      return data as unknown as BatchDetail;
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

  // Fetch recipe info (includes brand for packaging dialog)
  const { data: recipe } = useQuery({
    queryKey: recipeKeys.detail(batch?.recipe_id ?? ""),
    queryFn: async () => {
      if (!batch?.recipe_id) return null;
      const { data, error } = await supabase
        .from("recipes")
        .select("id, name, brand_id, brands(id, name)")
        .eq("id", batch.recipe_id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!batch?.recipe_id,
  });

  const recipeBrand = (recipe?.brands as { id: string; name: string } | null) ?? null;

  // Fetch existing packaging session for batches already in packaging state
  const { data: existingSession } = useQuery({
    queryKey: packagingKeys.activeSessionForBatch(id),
    queryFn: async () => {
      const { data } = await supabase
        .from("session_line_items")
        .select("session_id")
        .eq("batch_id", id)
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: batch?.status === "packaging",
  });

  // Fetch batch yeast data for the harvest dialog (which strains were pitched)
  const { data: batchYeastData = [] } = useQuery({
    queryKey: batchKeys.yeastSummary(id),
    queryFn: async () => {
      const { data: result } = await (supabase as unknown as { from: (table: string) => { select: (columns: string) => { eq: (column: string, value: string) => PromiseLike<{ data: Array<{ pitch_id: string; strain_id: string; strain_name: string; generation: number }> | null; error: unknown }> } } })
        .from("batch_yeast_summary")
        .select("pitch_id, strain_id, strain_name, generation")
        .eq("batch_id", id);
      return result || [];
    },
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
    segments.push({ label: batch?.batch_code ?? "Batch" }); // current page, no href
    return segments;
  }, [recipe, linkedBrewLogs, batch]);

  // Banner config based on batch status and brew log linkage
  const bannerConfig = useMemo(() => {
    if (!batch) return null;

    if (batch.status === "planned" && !linkedBrewLogs?.length) {
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
        message: "Brew is linked. Transfer to a fermenter or pitch yeast to begin.",
        variant: "info" as const,
        actions: [
          { label: "View Brew Log", href: `/production/brew-logs/${linkedBrewLogs[0].brew_log_id}` },
          { label: "Transfer", onClick: () => setShowTransfer(true) },
          { label: "Pitch Yeast", onClick: () => setShowPitchYeast(true) },
        ],
      };
    }
    if (batch.status === "fermenting") {
      const actions: { label: string; href?: string; onClick?: () => void }[] = [];
      if (linkedBrewLogs?.length) {
        actions.push({ label: "View Brew Log", href: `/production/brew-logs/${linkedBrewLogs[0].brew_log_id}` });
      }
      actions.push(
        { label: "Readings", href: `/production/batches/${id}/readings` },
        { label: "Additions", href: `/production/batches/${id}/additions` },
      );
      return {
        message: "Track fermentation progress with readings and additions.",
        variant: "default" as const,
        actions,
      };
    }
    if (linkedBrewLogs?.length) {
      return {
        message: `Linked to brew ${linkedBrewLogs[0].brew_log?.brew_number ?? "log"}.`,
        variant: "default" as const,
        actions: [
          { label: "View Brew Log", href: `/production/brew-logs/${linkedBrewLogs[0].brew_log_id}` },
        ],
      };
    }
    return null;
  }, [batch, linkedBrewLogs, id]);

  /**
   * Complete the batch and confirm its planned brew-day consumption:
   * transitions status to completed, then flips planned inventory_lot→batch
   * allocations to completed so ingredient inventory is actually depleted.
   */
  const completeBatch = useCallback(async () => {
    const client = createClient();
    const { error } = await client
      .from("batches")
      .update({ status: "completed" })
      .eq("id", id);
    if (error) {
      toast.error(`Failed to complete batch: ${error.message}`);
      return;
    }
    const result = await completeBatchConsumption(client, id);
    if (!result.success) {
      toast.error(`Batch completed, but confirming ingredient consumption failed: ${formatServiceError(result.error)}`);
    } else if (result.data > 0) {
      toast.success(`Batch completed — ${result.data} ingredient allocation${result.data === 1 ? "" : "s"} confirmed`);
    } else {
      toast.success("Batch completed");
    }
    queryClient.invalidateQueries({ queryKey: batchKeys.detail(id) });
    queryClient.invalidateQueries({ queryKey: batchKeys.all() });
  }, [id, queryClient]);

  // Custom action handler for batch-specific actions.
  // Returns true when the action is handled by a dialog, false to let EntityDetail handle it.
  const handleAction = useCallback((actionName: string) => {
    if (actionName === "complete") {
      // Handled here (not the generic state transition) so planned
      // brew-day consumption allocations are completed alongside the batch.
      void completeBatch();
      return true;
    }
    if (actionName === "start_brew_day") {
      setShowStartBrewDay(true);
      return true;
    }
    if (actionName === "transfer") {
      setShowTransfer(true);
      return true;
    }
    if (actionName === "pitch_yeast") {
      setShowPitchYeast(true);
      return true;
    }
    if (actionName === "harvest_yeast") {
      setShowHarvestYeast(true);
      return true;
    }
    // Both cancel and archive use the same dialog (it adapts based on status)
    if (actionName === "cancel" || actionName === "archive") {
      setShowCancellation(true);
      return true;
    }
    if (actionName === "blend") {
      setShowBlend(true);
      return true;
    }
    if (actionName === "start_packaging") {
      setShowStartPackaging(true);
      return true;
    }
    return false;
  }, [completeBatch]);

  const handleDialogSuccess = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: batchKeys.detail(id) });
    queryClient.invalidateQueries({ queryKey: batchKeys.yeastSummary(id) });
  }, [queryClient, id]);

  const handleBrewDayCreated = useCallback(
    (brewLogId: string) => {
      queryClient.invalidateQueries({ queryKey: batchKeys.brewLogLinks(id) });
      queryClient.invalidateQueries({ queryKey: batchKeys.brewLogs(id) });
      queryClient.invalidateQueries({ queryKey: batchKeys.detail(id) });
      // With a recipe, confirm ingredient consumption (FIFO lot suggestions)
      // before navigating to the brew log; without one there is nothing to plan.
      if (batch?.recipe_id) {
        setPendingBrewLogId(brewLogId);
      } else {
        router.push(`/production/brew-logs/${brewLogId}`);
      }
    },
    [queryClient, id, router, batch?.recipe_id]
  );

  /** Continue to the brew log after the consumption dialog confirms/skips. */
  const handleConsumptionDone = useCallback(() => {
    if (pendingBrewLogId) {
      router.push(`/production/brew-logs/${pendingBrewLogId}`);
      setPendingBrewLogId(null);
    }
  }, [pendingBrewLogId, router]);

  /** Suggest a batch state transition via a toast confirmation. */
  const handleSuggestTransition = useCallback(async (toState: string) => {
    const stateLabel = toState === "fermenting" ? "fermenting" : toState === "conditioning" ? "conditioning" : toState;

    toast(`Mark batch as ${stateLabel}?`, {
      action: {
        label: "Yes, update",
        onClick: async () => {
          const client = createClient();
          const { error } = await client
            .from("batches")
            .update({ status: toState })
            .eq("id", id);
          if (error) {
            toast.error("Failed to update status");
          } else {
            queryClient.invalidateQueries({ queryKey: batchKeys.detail(id) });
            toast.success(`Batch marked as ${stateLabel}`);
          }
        },
      },
      cancel: { label: "Not yet", onClick: () => {} },
      duration: 10000,
    });
  }, [id, queryClient]);

  return (
    <div className="space-y-4">
      <EntityBreadcrumb segments={breadcrumbSegments} />

      {batch?.status === "packaging" && existingSession && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
          <span>This batch has an active packaging session.</span>
          <Link
            href={`/production/packaging/${existingSession.session_id}`}
            className="font-medium text-blue-600 underline"
          >
            View Session
          </Link>
        </div>
      )}

      {batch?.status === "packaging" && !existingSession && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
          <span>This batch is in packaging status but has no linked session.</span>
          <button
            onClick={() => setShowAddToSession(true)}
            className="font-medium text-amber-600 underline"
          >
            Add to Session
          </button>
        </div>
      )}

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

      <BatchPackagingHistory batchId={id} />

      {batch && batch.id && batch.batch_code && (
        <>
          <PitchYeastDialog
            open={showPitchYeast}
            onOpenChange={setShowPitchYeast}
            batchId={batch.id}
            batchName={batch.name}
            batchStatus={batch.status}
            batchVolumeBbl={batch.volume_bbl}
            recipeOg={batch.target_og}
            onSuccess={handleDialogSuccess}
            onSuggestTransition={(state) => handleSuggestTransition(state)}
          />

          <YeastHarvestDialog
            open={showHarvestYeast}
            onOpenChange={setShowHarvestYeast}
            batchId={batch.id}
            batchName={batch.name}
            pitchedStrains={batchYeastData}
            onSuccess={handleDialogSuccess}
          />

          <BatchCancellationDialog
            batchId={batch.id}
            batchNumber={batch.batch_code}
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
            batchNumber={batch.batch_code}
            batchName={batch.name}
            open={showBlend}
            onOpenChange={setShowBlend}
            onSuccess={handleDialogSuccess}
          />

          <VesselTransferDialog
            batchId={batch.id}
            batchNumber={batch.batch_code}
            batchStatus={batch.status}
            fromVesselId={batch.current_vessel_id}
            fromVesselName={batch.current_vessel_name}
            currentVolume={batch.volume_bbl}
            open={showTransfer}
            onOpenChange={setShowTransfer}
            onSuccess={handleDialogSuccess}
            onSuggestTransition={(state) => handleSuggestTransition(state)}
          />

          <StartBrewDayDialog
            batchId={batch.id}
            batchNumber={batch.batch_code}
            batchName={batch.name}
            recipeName={recipe?.name ?? null}
            volumeBbl={batch.volume_bbl}
            open={showStartBrewDay}
            onOpenChange={setShowStartBrewDay}
            onSuccess={handleBrewDayCreated}
          />

          {batch.recipe_id && (
            <BrewConsumptionDialog
              batchId={batch.id}
              batchNumber={batch.batch_code}
              recipeId={batch.recipe_id}
              batchVolumeBbl={batch.volume_bbl}
              open={pendingBrewLogId !== null}
              // Navigation happens in onDone (confirm and skip both call it);
              // onOpenChange only mirrors the visual state.
              onOpenChange={(o) => {
                if (o) return;
              }}
              onDone={handleConsumptionDone}
            />
          )}

          {showStartPackaging && recipeBrand && (
            <PackagingBatchDialog
              open={showStartPackaging}
              onOpenChange={setShowStartPackaging}
              batchId={id}
              batchNumber={batch.batch_code}
              brandId={recipeBrand.id}
              brandName={recipeBrand.name}
            />
          )}

          {showAddToSession && recipeBrand && (
            <AddToPackagingSessionDialog
              open={showAddToSession}
              onOpenChange={setShowAddToSession}
              batchId={id}
              batchNumber={batch.batch_code}
              brandId={recipeBrand.id}
              brandName={recipeBrand.name}
            />
          )}
        </>
      )}
    </div>
  );
}
