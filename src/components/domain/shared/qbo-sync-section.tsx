"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { qboKeys } from "@/lib/query-keys";
import { CACHE_DURATIONS } from "@/lib/constants";
import {
  RefreshCw,
  Check,
  AlertCircle,
  CloudOff,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

export type QBOSyncSectionProps = {
  entityType: "customer" | "supplier" | "order" | "purchase_order";
  entityId: string;
}

/**
 * Parse a raw QBO error message into a user-friendly string.
 * Returns { friendly, raw } where `friendly` is the display message
 * and `raw` is the original error for debugging.
 */
export function parseQBOError(raw: string): { friendly: string; raw: string } {
  if (!raw) return { friendly: "Unknown error", raw };

  if (/QuickBooks accepted .* but MGR could not save its mapping/i.test(raw)) {
    return {
      friendly:
        "QuickBooks saved the document, but MGR could not save its link. Retry Sync WITHOUT editing this record first — reconciling re-links the existing document; edits made before reconciling will not reach QuickBooks on the retry.",
      raw,
    };
  }
  if (/AuthenticationFailed|token.*expired|unauthorized/i.test(raw)) {
    return {
      friendly:
        "QuickBooks connection expired. Please reconnect in Settings.",
      raw,
    };
  }
  if (/RateLimitExceeded|rate.?limit|throttl/i.test(raw)) {
    return {
      friendly:
        "QuickBooks is rate-limited. Please try again in a minute.",
      raw,
    };
  }
  if (/ValidationException|validation/i.test(raw)) {
    // Try to extract a detail message after a colon or dash
    const detail = raw.replace(/^.*ValidationException[:\s-]*/i, "").trim();
    return {
      friendly: detail
        ? `Data validation error: ${detail}`
        : "Data validation error. Check the sync log for details.",
      raw,
    };
  }

  return {
    friendly: "Sync failed. Check the sync log for details.",
    raw,
  };
}

export function QBOSyncSection({ entityType, entityId }: QBOSyncSectionProps) {
  const queryClient = useQueryClient();
  const [errorDetailOpen, setErrorDetailOpen] = useState(false);

  // Check QBO connection status
  const { data: connectionStatus } = useQuery({
    queryKey: qboKeys.status(),
    queryFn: async () => {
      const res = await fetch("/api/integrations/quickbooks/status");
      const json = await res.json();
      return json.data as { connected: boolean; companyName?: string };
    },
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
  });

  // Check sync status for this entity
  const { data: syncLog, isLoading } = useQuery({
    queryKey: qboKeys.syncStatus(entityType, entityId),
    queryFn: async () => {
      const res = await fetch(
        `/api/integrations/quickbooks/sync-log?entityType=${entityType}&entityId=${entityId}&limit=1`
      );
      const json = await res.json();
      const logs = json.data?.logs || [];
      return logs[0] || null;
    },
    enabled: connectionStatus?.connected === true,
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/integrations/quickbooks/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType, entityId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || "Sync failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Synced to QuickBooks");
      setErrorDetailOpen(false);
      queryClient.invalidateQueries({
        queryKey: qboKeys.syncStatus(entityType, entityId),
      });
    },
    onError: (err: Error) => {
      const { friendly } = parseQBOError(err.message);
      toast.error(friendly);
    },
  });

  // Don't render if QBO isn't connected
  if (!connectionStatus?.connected) return null;

  const lastLog = syncLog;
  const isSynced = lastLog?.status === "success";
  const isFailed = lastLog?.status === "error";
  const lastSyncTime = lastLog?.created_at
    ? formatDistanceToNow(new Date(lastLog.created_at), { addSuffix: true })
    : null;

  const errorInfo = isFailed && lastLog?.error_message
    ? parseQBOError(lastLog.error_message)
    : null;

  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="text-sm font-medium">QuickBooks</div>
          {isLoading ? (
            <Badge variant="outline">Checking...</Badge>
          ) : isSynced ? (
            <Badge variant="default" className="gap-1">
              <Check className="h-3 w-3" />
              Synced
            </Badge>
          ) : isFailed ? (
            <Badge variant="destructive" className="gap-1">
              <AlertCircle className="h-3 w-3" />
              Failed
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1">
              <CloudOff className="h-3 w-3" />
              Not Synced
            </Badge>
          )}
          {lastSyncTime && (
            <span className="text-xs text-muted-foreground">{lastSyncTime}</span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 mr-1.5 ${syncMutation.isPending ? "animate-spin" : ""}`}
          />
          {syncMutation.isPending ? "Syncing..." : isSynced ? "Re-sync" : "Sync"}
        </Button>
      </div>

      {errorInfo && (
        <Collapsible open={errorDetailOpen} onOpenChange={setErrorDetailOpen}>
          <div className="border-t px-4 py-2 bg-destructive/5">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-destructive">
                  {errorInfo.friendly}
                </p>
                <CollapsibleTrigger asChild>
                  <button className="text-xs text-muted-foreground hover:text-foreground mt-1 flex items-center gap-1">
                    <ChevronDown
                      className={`h-3 w-3 transition-transform ${errorDetailOpen ? "rotate-180" : ""}`}
                    />
                    {errorDetailOpen ? "Hide" : "Show"} error details
                  </button>
                </CollapsibleTrigger>
              </div>
            </div>
            <CollapsibleContent>
              <pre className="mt-2 text-xs text-muted-foreground bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                {errorInfo.raw}
              </pre>
            </CollapsibleContent>
          </div>
        </Collapsible>
      )}
    </div>
  );
}
