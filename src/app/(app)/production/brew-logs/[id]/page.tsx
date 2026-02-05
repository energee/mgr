"use client";

/**
 * Brew Log Detail Page
 *
 * Custom detail page that wraps EntityDetailUnified with brew-log-specific
 * action handling. The "complete_brew" action opens a vessel assignment
 * dialog instead of directly transitioning status.
 */

import { use, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { brewLogEntity } from "@/entities/brew-log";
import { BrewLogCompletionDialog } from "@/components/domain/brew-log-completion-dialog";
import { brewLogKeys, entityKeys } from "@/lib/query-keys";

export default function BrewLogDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const supabase = createClient();

  const [showCompletionDialog, setShowCompletionDialog] = useState(false);

  // Fetch brew log data for the dialog props
  const { data: brewLog } = useQuery({
    queryKey: brewLogKeys.detail(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brew_logs")
        .select("id, brew_number, status")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Intercept the complete_brew action to open the dialog
  const handleAction = useCallback((actionName: string) => {
    if (actionName === "complete_brew") {
      setShowCompletionDialog(true);
      return true; // Indicates action was handled
    }
    return false; // Let EntityDetailUnified handle normally
  }, []);

  const handleDialogSuccess = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: brewLogKeys.detail(id) });
    queryClient.invalidateQueries({ queryKey: entityKeys.detail("brew_logs", id) });
  }, [queryClient, id]);

  return (
    <>
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
    </>
  );
}
