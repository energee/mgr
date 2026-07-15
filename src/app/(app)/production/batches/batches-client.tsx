"use client";

/**
 * Batches List (client)
 *
 * The interactive batches list, split out from page.tsx so the route can be a
 * server component that prefetches the initial paged query and hydrates this
 * subtree (sitewide loading pattern — see
 * docs/plans/2026-07-15-sitewide-loading-pattern.md). Because the first-render
 * query is already in cache, only the route-level loading.tsx skeleton shows;
 * this component never flashes a second one.
 *
 * Includes custom action handling for cancel/archive dialogs, the start brew
 * day dialog, Start Packaging, and Transfer (all of which previously silently
 * no-oped from row menus — actions without a toState fall through to nothing in
 * entity-data-table). Pitch/harvest yeast route to the batch detail page via
 * the prefill store, which auto-opens the matching dialog there. Start Brew Day
 * chains into the BrewConsumptionDialog (FIFO ingredient allocations) when the
 * batch has a recipe, via useBrewConsumptionFlow (shared with the batch detail
 * page).
 */

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { EntityList } from "@/components/universal/entity-list";
import { batchEntity } from "@/entities/batch";
import { batchKeys, recipeKeys, entityKeys } from "@/lib/query-keys";
import { BatchCancellationDialog } from "@/components/domain/batch/batch-cancellation-dialog";
import { StartBrewDayDialog } from "@/components/domain/brew/start-brew-day-dialog";
import { PackagingBatchDialog } from "@/components/domain/packaging/packaging-batch-dialog";
import { VesselTransferDialog } from "@/components/domain/batch/vessel-transfer-dialog";
import { useBrewConsumptionFlow } from "@/components/domain/brew/use-brew-consumption-flow";
import { usePrefillStore } from "@/contexts/prefill-store";
import { entityService } from "@/services/entity-service";
import { formatServiceError } from "@/services/types";

type BatchRecord = {
  id: string;
  batch_code: string;
  name: string | null;
  status: string | null;
  volume_bbl: number | null;
  current_vessel_id: string | null;
  current_vessel_name: string | null;
  recipe_id: string | null;
}

export function BatchesClient() {
  const queryClient = useQueryClient();
  const supabase = createClient();
  const router = useRouter();
  const [selectedBatch, setSelectedBatch] = useState<BatchRecord | null>(null);
  const [showTerminationDialog, setShowTerminationDialog] = useState(false);
  const [showStartBrewDay, setShowStartBrewDay] = useState(false);
  const [showStartPackaging, setShowStartPackaging] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  // Brew log → consumption confirmation → navigate (shared flow, 9.1)
  const { handleBrewLogCreated, consumptionDialog } = useBrewConsumptionFlow(selectedBatch);

  // Recipe brand for the Start Packaging dialog. Mirrors the batch detail
  // page's recipe query (same key + select) so the cache is shared. A null
  // brand (recipe-less batch, or recipe without a brand) is handled by the
  // dialog's in-dialog brand picker.
  const { data: packagingRecipe, isLoading: packagingRecipeLoading } = useQuery({
    queryKey: recipeKeys.detail(selectedBatch?.recipe_id ?? ""),
    queryFn: async () => {
      if (!selectedBatch?.recipe_id) return null;
      const { data, error } = await supabase
        .from("recipes")
        .select("id, name, brand_id, target_og, brands(id, name), recipe_yeasts(yeast_id)")
        .eq("id", selectedBatch.recipe_id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: showStartPackaging && !!selectedBatch?.recipe_id,
  });
  const packagingBrand =
    (packagingRecipe?.brands as { id: string; name: string } | null) ?? null;

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
    if (actionName === "start_packaging") {
      setSelectedBatch(record as unknown as BatchRecord);
      setShowStartPackaging(true);
      return true;
    }
    if (actionName === "transfer") {
      setSelectedBatch(record as unknown as BatchRecord);
      setShowTransfer(true);
      return true;
    }
    // Pitch/harvest dialogs need recipe context only the detail page loads;
    // route there and let the prefill store auto-open the matching dialog
    // (same silent no-op bug class as transfer, cheapest correct fix).
    if (actionName === "pitch_yeast" || actionName === "harvest_yeast") {
      usePrefillStore.getState().setPrefill({}, actionName);
      router.push(`/production/batches/${(record as unknown as BatchRecord).id}`);
      return true;
    }
    return false;
  }, [router]);

  const handleDialogSuccess = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: batchKeys.all() });
    // The list itself is keyed on the view.
    queryClient.invalidateQueries({ queryKey: entityKeys.all("batches_with_brew_info") });
  }, [queryClient]);

  /** Post-transfer state suggestion (e.g. FV → Brite suggests conditioning). */
  const suggestTransition = useCallback(
    (batch: BatchRecord, toState: string) => {
      toast(`Mark batch as ${toState}?`, {
        action: {
          label: "Yes, update",
          onClick: async () => {
            const result = await entityService.transition(
              supabase,
              batchEntity,
              batch.id,
              toState
            );
            if (!result.success) {
              toast.error(`Failed to update status: ${formatServiceError(result.error)}`);
            } else {
              handleDialogSuccess();
              toast.success(`Batch marked as ${toState}`);
            }
          },
        },
        cancel: { label: "Not yet", onClick: () => {} },
        duration: 10000,
      });
    },
    [supabase, handleDialogSuccess]
  );

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

          <VesselTransferDialog
            batchId={selectedBatch.id}
            batchNumber={selectedBatch.batch_code}
            batchStatus={selectedBatch.status ?? undefined}
            fromVesselId={selectedBatch.current_vessel_id}
            fromVesselName={selectedBatch.current_vessel_name}
            currentVolume={selectedBatch.volume_bbl}
            open={showTransfer}
            onOpenChange={setShowTransfer}
            onSuccess={handleDialogSuccess}
            onSuggestTransition={(state) => suggestTransition(selectedBatch, state)}
          />

          {/* Mount once the recipe query has settled so a batch whose brand
              is still loading doesn't briefly show the in-dialog brand picker. */}
          {showStartPackaging && !packagingRecipeLoading && (
            <PackagingBatchDialog
              open={showStartPackaging}
              onOpenChange={setShowStartPackaging}
              batchId={selectedBatch.id}
              batchNumber={selectedBatch.batch_code}
              brandId={packagingBrand?.id ?? null}
              brandName={packagingBrand?.name ?? null}
              volumeBbl={selectedBatch.volume_bbl}
            />
          )}

          {consumptionDialog}
        </>
      )}
    </>
  );
}
