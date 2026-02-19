"use client";

/**
 * Brew Log Detail Page
 *
 * Custom detail page that wraps EntityDetailUnified with brew-log-specific
 * action handling. The "complete_brew" action opens a vessel assignment
 * dialog instead of directly transitioning status.
 */

import { use, useState, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { brewLogEntity } from "@/entities/brew-log";
import { BrewLogCompletionDialog } from "@/components/domain/brew-log-completion-dialog";
import { BrewLogRecipeSheet } from "@/components/domain/brew-log-recipe-sheet";
import { NextStepBanner } from "@/components/domain/next-step-banner";
import { BrewJourneyBreadcrumb } from "@/components/domain/brew-journey-breadcrumb";
import { Button } from "@/components/ui/button";
import { BookOpen } from "lucide-react";
import { brewLogKeys, entityKeys } from "@/lib/query-keys";

export default function BrewLogDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const router = useRouter();
  const supabase = createClient();

  const [showCompletionDialog, setShowCompletionDialog] = useState(false);
  const [showRecipeSheet, setShowRecipeSheet] = useState(false);

  // Fetch brew log data for banner logic and dialog props
  const { data: brewLog } = useQuery({
    queryKey: brewLogKeys.detail(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brew_logs")
        .select("id, brew_number, status, events")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Fetch linked batches (needed for "View batch" link and breadcrumb)
  const { data: linkedBatches } = useQuery({
    queryKey: brewLogKeys.batches(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brew_log_batches")
        .select("batch_id, batch:batches(batch_number, recipe_id, recipe:recipes(name))")
        .eq("brew_log_id", id);
      if (error) throw error;
      return (data ?? []) as Array<{
        batch_id: string;
        batch: {
          batch_number: string;
          recipe_id: string | null;
          recipe: { name: string } | null;
        } | null;
      }>;
    },
  });

  // Invalidate both the domain-specific and generic entity caches for this brew log
  const invalidateBrewLog = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: brewLogKeys.detail(id) });
    queryClient.invalidateQueries({ queryKey: entityKeys.detail("brew_logs", id) });
  }, [queryClient, id]);

  // Direct state transition for "Start Brew" from the banner
  const handleStartBrew = useCallback(async () => {
    const { error } = await supabase
      .from("brew_logs")
      .update({ status: "in_progress" })
      .eq("id", id);
    if (error) {
      toast.error("Failed to start brew");
      return;
    }
    invalidateBrewLog();
    toast.success("Brew started");
  }, [supabase, id, invalidateBrewLog]);

  // Intercept the complete_brew action to open the dialog
  const handleAction = useCallback((actionName: string) => {
    if (actionName === "complete_brew") {
      setShowCompletionDialog(true);
      return true;
    }
    return false;
  }, []);

  const handleDialogSuccess = useCallback(
    (navigateToBatchId?: string) => {
      invalidateBrewLog();
      if (navigateToBatchId) {
        router.push(`/production/batches/${navigateToBatchId}`);
      }
    },
    [invalidateBrewLog, router]
  );

  // Breadcrumb: Recipe -> Brew Log -> Batch (recipe derived from linked batches)
  const breadcrumbSegments = useMemo(() => {
    const segments: { label: string; href?: string }[] = [];
    // Recipe derived from first linked batch
    const firstBatch = linkedBatches?.[0];
    if (firstBatch?.batch?.recipe) {
      segments.push({
        label: firstBatch.batch.recipe.name,
        href: `/production/recipes/${firstBatch.batch.recipe_id}`,
      });
    }
    segments.push({ label: brewLog?.brew_number ?? "Brew Log" });
    if (linkedBatches?.length === 1) {
      const b = linkedBatches[0];
      const batchNumber = b.batch?.batch_number ?? "Batch";
      segments.push({ label: batchNumber, href: `/production/batches/${b.batch_id}` });
    }
    return segments;
  }, [brewLog, linkedBatches]);

  // Banner config based on brew log state
  const bannerConfig = useMemo(() => {
    if (!brewLog) return null;
    const events = (brewLog.events as unknown[]) || [];

    if (brewLog.status === "draft") {
      return {
        message: "Ready to start brewing? Begin recording your brew day.",
        variant: "info" as const,
        actions: [{ label: "Start Brew", onClick: handleStartBrew }],
      };
    }
    if (brewLog.status === "in_progress" && events.length > 0) {
      return {
        message:
          "Done brewing? Complete your brew log to move wort to fermenters.",
        variant: "info" as const,
        actions: [
          {
            label: "Complete Brew",
            onClick: () => setShowCompletionDialog(true),
          },
        ],
      };
    }
    if (brewLog.status === "completed" && linkedBatches?.length) {
      const isSingleBatch = linkedBatches.length === 1;
      return {
        message: isSingleBatch
          ? "Brew complete. View your batch in the fermenter."
          : `Brew complete. ${linkedBatches.length} batches are in fermentation.`,
        variant: "success" as const,
        actions: isSingleBatch
          ? [{ label: "View Batch", href: `/production/batches/${linkedBatches[0].batch_id}` }]
          : linkedBatches.map((b, i) => ({
              label: `Batch ${i + 1}`,
              href: `/production/batches/${b.batch_id}`,
            })),
      };
    }
    return null;
  }, [brewLog, linkedBatches, handleStartBrew]);

  // Recipe info derived from first linked batch
  const recipeInfo = useMemo(() => {
    const recipe = linkedBatches?.[0]?.batch?.recipe;
    const recipeId = linkedBatches?.[0]?.batch?.recipe_id;
    if (!recipe || !recipeId) return null;
    return { id: recipeId, name: recipe.name };
  }, [linkedBatches]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <BrewJourneyBreadcrumb segments={breadcrumbSegments} />
        {recipeInfo && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowRecipeSheet(true)}
          >
            <BookOpen className="mr-1.5 h-4 w-4" />
            Recipe
          </Button>
        )}
      </div>

      {bannerConfig && (
        <NextStepBanner
          message={bannerConfig.message}
          actions={bannerConfig.actions}
          variant={bannerConfig.variant}
        />
      )}

      <EntityDetailUnifiedWithErrorBoundary
        entity={brewLogEntity}
        id={id}
        basePath="/production/brew-logs"
        onAction={handleAction}
      />

      {brewLog && (
        <BrewLogCompletionDialog
          brewLogId={brewLog.id}
          brewNumber={brewLog.brew_number}
          open={showCompletionDialog}
          onOpenChange={setShowCompletionDialog}
          onSuccess={handleDialogSuccess}
        />
      )}

      {recipeInfo && (
        <BrewLogRecipeSheet
          recipeId={recipeInfo.id}
          recipeName={recipeInfo.name}
          open={showRecipeSheet}
          onOpenChange={setShowRecipeSheet}
        />
      )}
    </div>
  );
}
