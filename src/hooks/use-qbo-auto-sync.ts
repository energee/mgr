"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { qboKeys } from "@/lib/query-keys";

// Map of entity names to their sync entity types and trigger states
const AUTO_SYNC_CONFIG: Record<string, { entityType: string; triggerStates: string[] }> = {
  order: { entityType: "order", triggerStates: ["fulfilled"] },
  purchase_order: { entityType: "purchase_order", triggerStates: ["fulfilled"] },
};

export function useQBOAutoSync(entityName: string) {
  // Check QBO connection status (cached, minimal overhead)
  const { data: connectionStatus } = useQuery({
    queryKey: qboKeys.status(),
    queryFn: async () => {
      const res = await fetch("/api/integrations/quickbooks/status");
      if (!res.ok) return { connected: false, autoSyncEnabled: false };
      return (await res.json()).data;
    },
    staleTime: 60_000, // Cache for 1 minute
  });

  const triggerSync = useCallback(
    (entityId: string, toState: string) => {
      // Guard: is this entity configured for auto-sync?
      const config = AUTO_SYNC_CONFIG[entityName];
      if (!config) return;

      // Guard: is this a trigger state?
      if (!config.triggerStates.includes(toState)) return;

      // Guard: is QBO connected and auto-sync enabled?
      if (!connectionStatus?.connected) return;
      if (!connectionStatus?.autoSyncEnabled) return;

      // Fire-and-forget sync
      fetch("/api/integrations/quickbooks/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: config.entityType,
          entityId,
        }),
      })
        .then((res) => {
          if (res.ok) {
            toast.success("Synced to QuickBooks", { duration: 3000 });
          } else {
            res.json().then((data) => {
              toast.error(`QBO sync failed: ${data.error?.message || "Unknown error"}`, {
                duration: 5000,
              });
            });
          }
        })
        .catch(() => {
          // Silent failure - logged server-side in qbo_sync_log
        });
    },
    [entityName, connectionStatus]
  );

  return { triggerSync };
}
