"use client";

/**
 * useBrewConsumptionFlow - Shared Start Brew Day → consumption → brew log chain
 *
 * After StartBrewDayDialog creates a brew log, batches with a recipe should
 * confirm brew-day ingredient consumption (BrewConsumptionDialog, FIFO lot
 * suggestions) before navigating to the new brew log; batches without a recipe
 * navigate immediately (there is nothing to plan). This hook owns that
 * chaining — the pending brew-log id, the conditional consumption dialog, and
 * the post-confirm/skip navigation — so the batches list and batch detail
 * pages share one implementation.
 *
 * Usage:
 *   const { handleBrewLogCreated, consumptionDialog } = useBrewConsumptionFlow(batch);
 *   // call handleBrewLogCreated(brewLogId) from StartBrewDayDialog's onSuccess
 *   // (after any page-specific cache invalidation) and render {consumptionDialog}.
 */

import { useState, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BrewConsumptionDialog } from "@/components/domain/brew/brew-consumption-dialog";

/** The batch fields the consumption flow needs. */
type BrewConsumptionBatch = {
  id: string;
  batch_code: string;
  recipe_id: string | null;
  volume_bbl: number | null;
};

export function useBrewConsumptionFlow(batch: BrewConsumptionBatch | null): {
  /** Continue the flow after a brew log is created (StartBrewDayDialog onSuccess). */
  handleBrewLogCreated: (brewLogId: string) => void;
  /** Render this alongside the page's other dialogs (null when no recipe). */
  consumptionDialog: ReactNode;
} {
  const router = useRouter();
  // Brew log created, waiting for ingredient consumption confirmation (9.1)
  const [pendingBrewLogId, setPendingBrewLogId] = useState<string | null>(null);

  const handleBrewLogCreated = useCallback(
    (brewLogId: string) => {
      // With a recipe, confirm ingredient consumption (FIFO lot suggestions)
      // before navigating to the brew log; without one there is nothing to plan.
      if (batch?.recipe_id) {
        setPendingBrewLogId(brewLogId);
      } else {
        router.push(`/production/brew-logs/${brewLogId}`);
      }
    },
    [batch?.recipe_id, router]
  );

  /** Continue to the brew log after consumption is confirmed/skipped. */
  const handleConsumptionDone = useCallback(() => {
    if (pendingBrewLogId) {
      router.push(`/production/brew-logs/${pendingBrewLogId}`);
      setPendingBrewLogId(null);
    }
  }, [pendingBrewLogId, router]);

  const consumptionDialog: ReactNode =
    batch && batch.recipe_id ? (
      <BrewConsumptionDialog
        batchId={batch.id}
        batchNumber={batch.batch_code}
        recipeId={batch.recipe_id}
        batchVolumeBbl={batch.volume_bbl}
        open={pendingBrewLogId !== null}
        // Navigation happens in onDone (confirm and skip both call it)
        onDone={handleConsumptionDone}
      />
    ) : null;

  return { handleBrewLogCreated, consumptionDialog };
}
