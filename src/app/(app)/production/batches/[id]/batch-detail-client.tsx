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
 *   flipped to completed alongside the status change (shared registry:
 *   the transition_entity_atomic RPC).
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useBrewConsumptionFlow } from "@/components/domain/brew/use-brew-consumption-flow";
import { entityService } from "@/services/entity-service";
import { formatServiceError } from "@/services/types";
import { PackagingBatchDialog } from "@/components/domain/packaging/packaging-batch-dialog";
import { AddToPackagingSessionDialog } from "@/components/domain/packaging/add-to-packaging-session-dialog";
import { BatchPackagingHistory } from "@/components/domain/batch/batch-packaging-history";
import { BatchLossSummary } from "@/components/domain/batch/batch-loss-summary";
import { NextStepBanner } from "@/components/domain/shared/next-step-banner";
import { EntityBreadcrumb } from "@/components/universal/entity-breadcrumb";
import { batchKeys, batchRecordInvalidationKeys, recipeKeys, packagingKeys } from "@/lib/query-keys";
import { unwrap } from "@/lib/supabase/query-helpers";
import { consumePrefill } from "@/contexts/prefill-store";

export function BatchDetailClient({ id }: { id: string }) {

  // All dialog states default to false so SSR and client hydration agree.
  // The prefill store reads sessionStorage (client-only), so consuming it
  // during render causes a hydration mismatch (SENTRY-7477285482). We defer
  // it to useEffect, which only runs after hydration.
  const [showPitchYeast, setShowPitchYeast] = useState(false);
  const [showHarvestYeast, setShowHarvestYeast] = useState(false);
  const [showCancellation, setShowCancellation] = useState(false);
  const [showBlend, setShowBlend] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showStartBrewDay, setShowStartBrewDay] = useState(false);
  const [showStartPackaging, setShowStartPackaging] = useState(false);
  const [showAddToSession, setShowAddToSession] = useState(false);

  useEffect(() => {
    const { openDialog } = consumePrefill();
    if (!openDialog) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client-only read from sessionStorage-backed store
    if (openDialog === "pitch_yeast") setShowPitchYeast(true);
    else if (openDialog === "harvest_yeast") setShowHarvestYeast(true);
    else if (openDialog === "cancel" || openDialog === "archive") setShowCancellation(true);
    else if (openDialog === "blend") setShowBlend(true);
    else if (openDialog === "transfer" || openDialog === "transfer_vessel") setShowTransfer(true);
  }, []);

  const queryClient = useQueryClient();
  const supabase = createClient();

  // Refresh the batch record everywhere it's cached — the domain detail key
  // AND the batches_with_brew_info view backing the unified header (status
  // badge, vessel info) and list pages. Invalidating batchKeys.detail alone
  // left the header badge stale after transitions (issue #560).
  const invalidateBatchRecord = useCallback(() => {
    for (const key of batchRecordInvalidationKeys(id)) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  }, [queryClient, id]);

  // Fetch batch data for the dialogs (use view to get vessel info and
  // actual_og, which the view computes from brew-log knockout measurements
  // and converts to SG in-view — migration 00204).
  // Note: the batches table/view has NO target_og column — recipe targets
  // come from the recipe query below.
  type BatchDetail = {
    id: string;
    batch_code: string;
    name: string;
    status: string;
    volume_bbl: number | null;
    actual_og: number | null;
    current_vessel_id: string | null;
    current_vessel_name: string | null;
    recipe_id: string | null;
  };
  const { data: batch } = useQuery({
    queryKey: batchKeys.detail(id),
    queryFn: async () => {
      const data = await unwrap(
        supabase
          .from("batches_with_brew_info")
          .select("id, batch_code, name, status, volume_bbl, actual_og, current_vessel_id, current_vessel_name, recipe_id")
          .eq("id", id)
          .single()
      ) as unknown as BatchDetail | null;
      // Runtime-validate required fields before casting
      if (!data || typeof data.id !== "string") {
        throw new Error("Batch detail query returned invalid data");
      }
      return data;
    },
  });

  // Brew log → consumption confirmation → navigate (shared flow, 9.1)
  const { handleBrewLogCreated, consumptionDialog } = useBrewConsumptionFlow(batch ?? null);

  // Fetch linked brew logs for banner logic and breadcrumb
  // Uses a separate key from BrewLogLinker to avoid cache shape conflicts
  const { data: linkedBrewLogs } = useQuery({
    queryKey: batchKeys.brewLogLinks(id),
    queryFn: async () => {
      const data = await unwrap(
        supabase
          .from("brew_log_batches")
          .select("brew_log_id, brew_log:brew_logs(brew_number)")
          .eq("batch_id", id)
      );
      return (data ?? []) as Array<{
        brew_log_id: string;
        brew_log: { brew_number: string } | null;
      }>;
    },
  });

  // Fetch recipe info: brand for the packaging dialogs, target_og and yeast
  // strain links for the pitch-rate calculator in PitchYeastDialog.
  // recipeBrand stays null for recipe-less batches (query disabled) and for
  // recipes without a brand — the packaging dialogs handle that by showing
  // an in-dialog brand picker instead of silently not opening.
  const { data: recipe, isLoading: recipeLoading } = useQuery({
    queryKey: recipeKeys.detail(batch?.recipe_id ?? ""),
    queryFn: async () => {
      if (!batch?.recipe_id) return null;
      return await unwrap(
        supabase
          .from("recipes")
          .select("id, name, brand_id, target_og, brands(id, name), recipe_yeasts(yeast_id)")
          .eq("id", batch.recipe_id)
          .single()
      ) as unknown as {
        id: string;
        name: string;
        brand_id: string | null;
        target_og: number | null;
        brands: { id: string; name: string } | null;
        recipe_yeasts: { yeast_id: string }[] | null;
      };
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
    // This projection feeds YeastHarvestDialog and must not share the full
    // table summary key: React Query caches by key, not SELECT shape.
    queryKey: batchKeys.yeastStrains(id),
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
   * transitions status to completed (guarded on the loaded status so a
   * concurrent change by another user matches 0 rows instead of clobbering),
   * then runs the shared transition side effects
   * (the transition_entity_atomic RPC), which flip planned
   * inventory_lot→batch allocations to completed so ingredient inventory is
   * actually depleted.
   */
  const completeBatch = useCallback(async () => {
    if (!batch) return;
    const client = createClient();
    const result = await entityService.transition(
      client,
      batchEntity,
      id,
      "completed"
    );
    if (!result.success) {
      toast.error(`Failed to complete batch: ${formatServiceError(result.error)}`);
      invalidateBatchRecord();
      return;
    }
    toast.success("Batch completed");
    invalidateBatchRecord();
    queryClient.invalidateQueries({ queryKey: batchKeys.all() });
  }, [id, queryClient, batch, invalidateBatchRecord]);

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
    invalidateBatchRecord();
    queryClient.invalidateQueries({ queryKey: batchKeys.yeastSummary(id) });
    queryClient.invalidateQueries({ queryKey: batchKeys.yeastStrains(id) });
  }, [queryClient, id, invalidateBatchRecord]);

  const handlePitchDialogSuccess = useCallback(() => {
    // PitchYeastDialog owns its yeast projections; the parent only refreshes
    // the batch record used by the surrounding detail page.
    invalidateBatchRecord();
  }, [invalidateBatchRecord]);

  const handleBrewDayCreated = useCallback(
    (brewLogId: string) => {
      queryClient.invalidateQueries({ queryKey: batchKeys.brewLogLinks(id) });
      queryClient.invalidateQueries({ queryKey: batchKeys.brewLogs(id) });
      invalidateBatchRecord();
      // Shared flow: consumption confirmation (with recipe) or direct navigation.
      handleBrewLogCreated(brewLogId);
    },
    [queryClient, id, handleBrewLogCreated, invalidateBatchRecord]
  );

  /** Suggest a batch state transition via a toast confirmation. */
  const handleSuggestTransition = useCallback(async (toState: string) => {
    const stateLabel = toState === "fermenting" ? "fermenting" : toState === "conditioning" ? "conditioning" : toState;

    toast(`Mark batch as ${stateLabel}?`, {
      action: {
        label: "Yes, update",
        onClick: async () => {
          const client = createClient();
          if (!batch) return;
          const result = await entityService.transition(
            client,
            batchEntity,
            id,
            toState
          );
          if (!result.success) {
            toast.error(`Failed to update status: ${formatServiceError(result.error)}`);
          } else {
            invalidateBatchRecord();
            toast.success(`Batch marked as ${stateLabel}`);
          }
        },
      },
      cancel: { label: "Not yet", onClick: () => {} },
      duration: 10000,
    });
  }, [id, batch, invalidateBatchRecord]);

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

      <BatchLossSummary batchId={id} status={batch?.status ?? null} />

      {batch && batch.id && batch.batch_code && (
        <>
          <PitchYeastDialog
            open={showPitchYeast}
            onOpenChange={setShowPitchYeast}
            batchId={batch.id}
            batchName={batch.name}
            batchStatus={batch.status}
            batchVolumeBbl={batch.volume_bbl}
            // Prefer measured knockout OG (pitching happens post-knockout);
            // fall back to the recipe's target.
            recipeOg={batch.actual_og ?? recipe?.target_og}
            recipeYeastIds={recipe?.recipe_yeasts?.map((ry) => ry.yeast_id)}
            onSuccess={handlePitchDialogSuccess}
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

          {consumptionDialog}

          {/* Packaging dialogs: mount once the recipe query has settled so a
              batch whose brand is still loading doesn't briefly show the
              in-dialog brand picker. A null brand (no recipe, or recipe
              without a brand) is handled inside the dialogs. */}
          {showStartPackaging && !recipeLoading && (
            <PackagingBatchDialog
              open={showStartPackaging}
              onOpenChange={setShowStartPackaging}
              batchId={id}
              batchNumber={batch.batch_code}
              brandId={recipeBrand?.id ?? null}
              brandName={recipeBrand?.name ?? null}
              volumeBbl={batch.volume_bbl}
            />
          )}

          {showAddToSession && !recipeLoading && (
            <AddToPackagingSessionDialog
              open={showAddToSession}
              onOpenChange={setShowAddToSession}
              batchId={id}
              batchNumber={batch.batch_code}
              brandId={recipeBrand?.id ?? null}
              brandName={recipeBrand?.name ?? null}
            />
          )}
        </>
      )}
    </div>
  );
}
