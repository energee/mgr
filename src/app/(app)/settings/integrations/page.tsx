"use client";

/**
 * Integrations Settings Page
 *
 * - Anthropic Claude (AI API key)
 * - Slack (notifications)
 * - Square POS (coming soon)
 * - QuickBooks (coming soon)
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SecretKeyInput } from "@/components/domain/secret-key-input";
import { Check, ExternalLink } from "lucide-react";
import { ClaudeIcon } from "@/components/ui/claude-icon";
import { SquareIcon } from "@/components/ui/square-icon";
import { QuickBooksIcon } from "@/components/ui/quickbooks-icon";
import { SlackIntegrationCard } from "@/components/domain/slack-integration-card";
import { qboKeys } from "@/lib/query-keys";

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
// QuickBooks Integration Card (dedicated card with connection status)
// =============================================================================

function QuickBooksIntegrationCard() {
  const { data: status, isLoading } = useQuery({
    queryKey: qboKeys.status(),
    queryFn: async () => {
      const res = await fetch("/api/integrations/quickbooks/status");
      if (!res.ok) return { connected: false };
      return (await res.json()).data;
    },
    staleTime: 30_000,
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
          {isLoading ? (
            <Badge variant="outline">Checking...</Badge>
          ) : isConnected ? (
            <Badge variant="default">Connected</Badge>
          ) : (
            <Badge variant="secondary">Not Connected</Badge>
          )}
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
        <div className="flex items-center justify-between">
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

      {/* Square POS */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <SquareIcon className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg">Square POS</CardTitle>
                <CardDescription>
                  Sync orders from Square Point of Sale. Automatically import taproom and retail sales.
                </CardDescription>
              </div>
            </div>
            <Badge variant="secondary">Beta</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <IntegrationKeySection
            integrationId="square"
            keyLabel="Square Access Token"
            keyPlaceholder="sq0atp-..."
          />
          <div>
            <h4 className="text-sm font-medium mb-2">Features</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                Automatic order import
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                Real-time inventory sync
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                Customer data integration
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* QuickBooks */}
      <QuickBooksIntegrationCard />
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
