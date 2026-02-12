"use client";

/**
 * Integrations Settings Page
 *
 * AI integration and external service integrations:
 * - Anthropic Claude (Anthropic API key)
 * - Square POS (catalog/inventory sync + draft sales)
 * - Slack (notifications)
 * - QuickBooks (coming soon)
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, RefreshCw } from "lucide-react";
import { SecretKeyInput } from "@/components/domain/secret-key-input";
import { ClaudeIcon } from "@/components/ui/claude-icon";
import { SquareIcon } from "@/components/ui/square-icon";
import { QuickBooksIcon } from "@/components/ui/quickbooks-icon";
import { SlackIntegrationCard } from "@/components/domain/slack-integration-card";
import { squareKeys } from "@/lib/query-keys";

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
          <Badge variant={hasExistingKey ? "outline" : "secondary"}>
            {hasExistingKey ? "Connected" : "Not Connected"}
          </Badge>
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

  const isConnected = status?.isEnabled && status?.catalogItemCount > 0;

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
          {isConnected ? (
            <Badge variant="default">Connected</Badge>
          ) : status?.isEnabled ? (
            <Badge variant="secondary">Enabled</Badge>
          ) : (
            <Badge variant="outline">Not Connected</Badge>
          )}
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
                    <span>
                      Catalog: {new Date(status.lastCatalogSync).toLocaleString()}
                    </span>
                  )}
                  {status?.lastInventorySync && (
                    <span>
                      Inventory: {new Date(status.lastInventorySync).toLocaleString()}
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

            {/* Recent Sync Log */}
            {status?.recentSyncs?.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Recent Activity</h4>
                <div className="space-y-1">
                  {status.recentSyncs.slice(0, 5).map((sync: { id: string; syncType: string; itemsSynced: number; itemsFailed: number; startedAt: string }) => (
                    <div key={sync.id} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {sync.syncType.replace("_", " ")} — {new Date(sync.startedAt).toLocaleString()}
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
              "Inbound draft sales tracking",
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
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <QuickBooksIcon className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg">QuickBooks</CardTitle>
                <CardDescription>
                  Sync financial data with QuickBooks Online. Automate invoicing and expense tracking.
                </CardDescription>
              </div>
            </div>
            <Badge variant="secondary">Beta</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <IntegrationKeySection
            integrationId="quickbooks"
            keyLabel="QuickBooks Client ID"
            keyPlaceholder="AB1cd2EFgh3..."
          />
          <div>
            <h4 className="text-sm font-medium mb-2">Features</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                Invoice sync
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                Expense tracking
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                Inventory valuation
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

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
