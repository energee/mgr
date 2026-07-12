"use client";

/**
 * Integrations Settings Page
 *
 * AI integration and external service integrations:
 * - Anthropic Claude (Anthropic API key)
 * - Square POS (catalog/inventory sync + draft sales)
 * - Slack (notifications)
 * - QuickBooks Online (invoices/bills sync)
 * - MongoDB (live data sync from lolev-manager)
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IntegrationBadge, type IntegrationStatus } from "@/components/domain/shared/integration-badge";
import { Switch } from "@/components/ui/switch";
import { Check, Database, ExternalLink, Loader2, MapPin, RefreshCw } from "lucide-react";
import { SecretKeyInput } from "@/components/domain/shared/secret-key-input";
import { ClaudeIcon } from "@/components/ui/claude-icon";
import { SquareIcon } from "@/components/ui/square-icon";
import { QuickBooksIcon } from "@/components/ui/quickbooks-icon";
import { SlackIntegrationCard } from "@/components/domain/shared/slack-integration-card";
import { mongodbKeys, qboKeys, squareKeys } from "@/lib/query-keys";
import { CACHE_DURATIONS } from "@/lib/constants";

// =============================================================================
// Global API Key Section (write-only — key is never read back to the client)
// =============================================================================

function GlobalApiKeySection() {
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [keyHint, setKeyHint] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/settings/api-key?scope=global")
      .then((res) => res.json())
      .then((data) => {
        setHasExistingKey(data.hasKey === true);
        setKeyHint(data.keyHint ?? null);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const saveKey = useMutation({
    mutationFn: async (key: string) => {
      const res = await fetch("/api/settings/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "global", key }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }
    },
    onSuccess: (_data, key) => {
      if (key) {
        setHasExistingKey(true);
        setKeyHint(`...${key.slice(-4)}`);
      } else {
        setHasExistingKey(false);
        setKeyHint(null);
      }
      toast.success(key ? "Global API key saved" : "Global API key removed");
    },
    onError: () => {
      toast.error("Failed to save API key");
    },
  });

  const testKey = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/api-key/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "global" }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Test failed");
      }
    },
    onSuccess: () => {
      toast.success("API key is valid");
    },
    onError: (err: Error) => {
      toast.error(`API key test failed: ${err.message}`);
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ClaudeIcon className="h-5 w-5 text-[#D97757]" />
              Anthropic Claude
            </CardTitle>
            <CardDescription>
              Configure Anthropic Claude for AI-powered assistance. This key is used as a fallback
              when individual users don&apos;t have their own key configured.
            </CardDescription>
          </div>
          <IntegrationBadge status={hasExistingKey ? "connected" : "not_connected"} />
        </div>
      </CardHeader>
      <CardContent>
        <SecretKeyInput
          label="Anthropic API Key"
          placeholder="sk-ant-..."
          hintPrefix="sk-ant-"
          isLoading={!loaded}
          hasExistingKey={hasExistingKey}
          keyHint={keyHint}
          onSave={(key) => saveKey.mutate(key)}
          onRemove={() => saveKey.mutate("")}
          isSaving={saveKey.isPending}
          onTest={() => testKey.mutate()}
          isTesting={testKey.isPending}
          helpText={
            <>
              Get your API key from{" "}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                console.anthropic.com
              </a>
            </>
          }
        />
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Integration API Key Section (reusable two-state card for external integrations)
// =============================================================================

function IntegrationKeySection({
  integrationId,
  keyLabel,
  keyPlaceholder,
}: {
  integrationId: string;
  keyLabel: string;
  keyPlaceholder: string;
}) {
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [keyHint, setKeyHint] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`/api/settings/api-key?scope=integration&id=${integrationId}`)
      .then((res) => res.json())
      .then((data) => {
        setHasExistingKey(data.hasKey === true);
        setKeyHint(data.keyHint ?? null);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [integrationId]);

  const saveKey = useMutation({
    mutationFn: async (key: string) => {
      const res = await fetch("/api/settings/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "integration", id: integrationId, key }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }
    },
    onSuccess: (_data, key) => {
      if (key) {
        setHasExistingKey(true);
        setKeyHint(`...${key.slice(-4)}`);
      } else {
        setHasExistingKey(false);
        setKeyHint(null);
      }
      toast.success(key ? `${keyLabel} saved` : `${keyLabel} removed`);
    },
    onError: () => {
      toast.error(`Failed to save ${keyLabel}`);
    },
  });

  return (
    <SecretKeyInput
      label={keyLabel}
      placeholder={keyPlaceholder}
      isLoading={!loaded}
      hasExistingKey={hasExistingKey}
      keyHint={keyHint}
      onSave={(key) => saveKey.mutate(key)}
      onRemove={() => saveKey.mutate("")}
      isSaving={saveKey.isPending}
    />
  );
}

// =============================================================================
// Square Integration Card (dedicated card with sync controls)
// =============================================================================

function SquareIntegrationCard() {
  const queryClient = useQueryClient();

  // Fetch sync status
  const { data: status } = useQuery({
    queryKey: squareKeys.syncStatus(),
    queryFn: async () => {
      const res = await fetch("/api/square/sync/status");
      if (!res.ok) return null;
      const data = await res.json();
      return data.data;
    },
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/square/sync", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || "Sync failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Square sync completed");
      queryClient.invalidateQueries({ queryKey: squareKeys.all() });
    },
    onError: (err: Error) => {
      toast.error(`Sync failed: ${err.message}`);
    },
  });

  // Toggle enabled
  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch("/api/square/sync/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_enabled: enabled }),
      });
      if (!res.ok) throw new Error("Failed to update");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: squareKeys.syncStatus() });
    },
  });

  // Reconcile staged draft (keg-pour) sales into TTB taproom-sale removals
  // (audit BD-2). Per-row failures are surfaced in a warning toast — never
  // silently swallowed (UI-7).
  const reconcileDraftSales = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/square/reconcile-draft-sales", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to reconcile draft sales");
      return data.data as {
        processed: number;
        reconciled: number;
        alreadyReconciled: number;
        failed: number;
        failures: Array<{ draftSaleId: string; error: string }>;
      };
    },
    onSuccess: (data) => {
      if (data.failed > 0) {
        toast.warning(
          `Reconciled ${data.reconciled} draft sale${data.reconciled === 1 ? "" : "s"}; ${data.failed} failed — see the Square sync log`
        );
      } else if (data.reconciled === 0 && data.alreadyReconciled > 0) {
        toast.success("All draft sales were already reconciled");
      } else {
        toast.success(`Reconciled ${data.reconciled} draft sale${data.reconciled === 1 ? "" : "s"}`);
      }
      queryClient.invalidateQueries({ queryKey: squareKeys.syncStatus() });
      queryClient.invalidateQueries({ queryKey: squareKeys.draftSales() });
    },
    onError: (err: Error) => {
      toast.error(`Draft-sale reconciliation failed: ${err.message}`);
    },
  });

  // Refresh Square locations (pulls locations.list into square_locations so bins
  // can be pointed at them). Invalidates status to refresh the POS-bins list.
  const refreshLocations = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/square/locations/refresh", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to refresh locations");
      return data.data as { count: number };
    },
    onSuccess: (data) => {
      toast.success(`Refreshed ${data.count} Square location${data.count === 1 ? "" : "s"}`);
      queryClient.invalidateQueries({ queryKey: squareKeys.syncStatus() });
    },
    onError: (err: Error) => {
      toast.error(`Failed to refresh locations: ${err.message}`);
    },
  });

  const posBins: Array<{
    id: string;
    name: string;
    squareLocationName: string | null;
    channelName: string | null;
  }> = status?.posBins ?? [];

  const isConnected = status?.isEnabled && status?.catalogItemCount > 0;
  const unreconciledDraftSales: number = status?.unreconciledDraftSales ?? 0;

  function getSquareStatus(): IntegrationStatus {
    if (isConnected) return "connected";
    if (status?.isEnabled) return "enabled";
    return "not_connected";
  }
  const squareStatus = getSquareStatus();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <SquareIcon className="h-5 w-5" />
              Square POS
            </CardTitle>
            <CardDescription>
              Sync products, prices, and inventory from MGR to Square. Track taproom sales for reconciliation.
            </CardDescription>
          </div>
          <IntegrationBadge status={squareStatus} />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Access Token */}
        <div>
          <h4 className="text-sm font-medium mb-2">Access Token</h4>
          <IntegrationKeySection
            integrationId="square"
            keyLabel="Square Access Token"
            keyPlaceholder="sq0atp-..."
          />
        </div>

        {/* Webhook Signature Key */}
        <div>
          <h4 className="text-sm font-medium mb-2">Webhook Signature Key</h4>
          <IntegrationKeySection
            integrationId="square-webhook"
            keyLabel="Webhook Signature Key"
            keyPlaceholder="sq0wsk-..."
          />
        </div>

        {/* Enable Toggle */}
        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <div>
            <p className="text-sm font-medium">Enable Sync</p>
            <p className="text-xs text-muted-foreground">
              When enabled, catalog and inventory syncs can be triggered
            </p>
          </div>
          <Switch
            checked={status?.isEnabled ?? false}
            onCheckedChange={(checked) => toggleMutation.mutate(checked)}
            disabled={toggleMutation.isPending}
          />
        </div>

        {/* Sync Controls */}
        {status?.isEnabled && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Catalog & Inventory Sync</p>
                <div className="flex gap-4 text-xs text-muted-foreground mt-1">
                  {status?.lastCatalogSync && (
                    <span suppressHydrationWarning>
                      Catalog: {new Date(status.lastCatalogSync).toLocaleString("en-US")}
                    </span>
                  )}
                  {status?.lastInventorySync && (
                    <span suppressHydrationWarning>
                      Inventory: {new Date(status.lastInventorySync).toLocaleString("en-US")}
                    </span>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
              >
                {syncMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-3 w-3" />
                    Sync Now
                  </>
                )}
              </Button>
            </div>

            {status?.catalogItemCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {status.catalogItemCount} items synced to Square
              </p>
            )}

            {/* Square Locations + per-bin POS config */}
            <div className="rounded-md border px-3 py-2 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" />
                    POS Bins
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Bins that push to Square. Configure a bin&apos;s Square location + channel on the bin.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refreshLocations.mutate()}
                  disabled={refreshLocations.isPending}
                >
                  {refreshLocations.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      Refreshing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-3 w-3" />
                      Refresh Locations
                    </>
                  )}
                </Button>
              </div>
              {posBins.length > 0 ? (
                <ul className="space-y-1">
                  {posBins.map((b) => (
                    <li key={b.id} className="flex items-center justify-between text-xs">
                      <span className="font-medium">{b.name}</span>
                      <span className="text-muted-foreground">
                        {b.squareLocationName ?? "—"} · {b.channelName ?? "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No bins configured for Square POS yet.
                </p>
              )}
            </div>

            {/* Draft-sale reconciliation (BD-2): staged keg pours -> TTB removals */}
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <p className="text-sm font-medium flex items-center gap-2">
                  Draft Sales
                  {unreconciledDraftSales > 0 && (
                    <Badge variant="secondary">{unreconciledDraftSales} unreconciled</Badge>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  Convert staged keg pours into taproom-sale removals (TTB)
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => reconcileDraftSales.mutate()}
                disabled={reconcileDraftSales.isPending || unreconciledDraftSales === 0}
              >
                {reconcileDraftSales.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    Reconciling...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-3 w-3" />
                    Reconcile draft sales
                  </>
                )}
              </Button>
            </div>

            {/* Recent Sync Log */}
            {status?.recentSyncs?.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Recent Activity</h4>
                <div className="space-y-1">
                  {status.recentSyncs.slice(0, 5).map((sync: { id: string; syncType: string; itemsSynced: number; itemsFailed: number; startedAt: string }) => (
                    <div key={sync.id} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground" suppressHydrationWarning>
                        {sync.syncType.replace("_", " ")} — {new Date(sync.startedAt).toLocaleString("en-US")}
                      </span>
                      <span>
                        {sync.itemsSynced} synced
                        {sync.itemsFailed > 0 && (
                          <span className="text-red-500 ml-1">{sync.itemsFailed} failed</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Features */}
        <div>
          <h4 className="text-sm font-medium mb-2">Features</h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            {[
              "Outbound catalog sync (products & prices)",
              "Inventory count sync (cases \u2192 selling units)",
              "Inbound draft sales tracking & TTB reconciliation",
              "Multi-location support",
            ].map((feature, index) => (
              <li key={index} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                {feature}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// QuickBooks Integration Card (dedicated card with connection status)
// =============================================================================

function QuickBooksIntegrationCard() {
  const { data: status } = useQuery({
    queryKey: qboKeys.status(),
    queryFn: async () => {
      const res = await fetch("/api/integrations/quickbooks/status");
      if (!res.ok) return { connected: false };
      return (await res.json()).data;
    },
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
  });

  const isConnected = status?.connected === true;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <QuickBooksIcon className="h-5 w-5" />
              QuickBooks Online
            </CardTitle>
            <CardDescription>
              Sync invoices and bills with QuickBooks Online. Automate accounting
              for orders and purchase orders.
            </CardDescription>
          </div>
          <IntegrationBadge status={isConnected ? "connected" : "not_connected"} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isConnected && status?.companyName && (
          <div className="flex items-center gap-2 text-sm">
            <Check className="h-4 w-4 text-green-600" />
            <span>
              Connected to <strong>{status.companyName}</strong>
            </span>
          </div>
        )}
        {!isConnected && (
          <IntegrationKeySection
            integrationId="quickbooks"
            keyLabel="QuickBooks Client ID"
            keyPlaceholder="AB1cd2EFgh3..."
          />
        )}
        {/* Features */}
        <div>
          <h4 className="text-sm font-medium mb-2">Features</h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            {[
              "Auto-sync invoices from orders",
              "Auto-sync bills from purchase orders",
              "Customer & supplier mapping",
              "Tax exemption support",
            ].map((feature, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                {feature}
              </li>
            ))}
          </ul>
        </div>

        <Link href="/settings/integrations/quickbooks">
          <Button variant="outline" size="sm">
            Settings
            <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// MongoDB Integration Card
// =============================================================================

function MongoDBIntegrationCard() {
  const { data: status } = useQuery({
    queryKey: mongodbKeys.status(),
    queryFn: async () => {
      const res = await fetch("/api/integrations/mongodb/status");
      if (!res.ok) return { connected: false };
      return (await res.json()).data;
    },
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
  });

  const integrationStatus: IntegrationStatus = status?.connected ? "connected" : "not_connected";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Database className="h-6 w-6" />
            <div>
              <CardTitle className="text-base">MongoDB Sync</CardTitle>
              <CardDescription>
                Sync data from lolev-manager
              </CardDescription>
            </div>
          </div>
          <IntegrationBadge status={integrationStatus} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="text-sm text-muted-foreground space-y-1">
          <li>Suppliers, malts, hops, yeasts, beer styles</li>
          <li>Brands, vessels, batches, transfers</li>
          <li>Orders, order items, batch readings</li>
        </ul>
        <Link href="/settings/integrations/mongodb">
          <Button variant="outline" size="sm">
            Settings
            <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

export default function IntegrationsPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Integrations</h1>
        <p className="text-muted-foreground">
          Connect external services to extend your brewery management
        </p>
      </div>

      {/* AI Integration */}
      <GlobalApiKeySection />

      {/* Slack Integration */}
      <SlackIntegrationCard />

      {/* Square POS - dedicated card with sync controls */}
      <SquareIntegrationCard />

      {/* QuickBooks */}
      <QuickBooksIntegrationCard />

      {/* MongoDB Sync */}
      <MongoDBIntegrationCard />

      {/* Custom Integration Section */}
      <Card>
        <CardHeader>
          <CardTitle>Custom Integrations</CardTitle>
          <CardDescription>
            Need to integrate with a service not listed here? MGR provides a webhook system
            and REST API for custom integrations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <Button variant="outline" disabled>
              API Documentation
              <Badge variant="secondary" className="ml-2">Coming Soon</Badge>
            </Button>
            <Button variant="outline" disabled>
              Webhook Settings
              <Badge variant="secondary" className="ml-2">Coming Soon</Badge>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
