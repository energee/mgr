"use client";

/**
 * Integrations Settings Page
 *
 * AI integration and external service integrations:
 * - Anthropic Claude (Anthropic API key)
 * - Square POS (order sync)
 * - Slack (notifications)
 * - QuickBooks (accounting)
 */

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import { ClaudeIcon } from "@/components/ui/claude-icon";
import { SquareIcon } from "@/components/ui/square-icon";
import { SlackIcon } from "@/components/ui/slack-icon";
import { QuickBooksIcon } from "@/components/ui/quickbooks-icon";

const integrationIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  square: SquareIcon,
  slack: SlackIcon,
  quickbooks: QuickBooksIcon,
};

const integrations = [
  {
    id: "square",
    name: "Square POS",
    description: "Sync orders from Square Point of Sale. Automatically import taproom and retail sales.",
    status: "beta" as const,
    keyLabel: "Square Access Token",
    keyPlaceholder: "sq0atp-...",
    features: [
      "Automatic order import",
      "Real-time inventory sync",
      "Customer data integration",
    ],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Send notifications to Slack channels. Get alerts for low inventory, batch status changes, and more.",
    status: "beta" as const,
    keyLabel: "Slack Webhook URL",
    keyPlaceholder: "https://hooks.slack.com/services/...",
    features: [
      "Channel notifications",
      "Customizable alerts",
      "Batch status updates",
    ],
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    description: "Sync financial data with QuickBooks Online. Automate invoicing and expense tracking.",
    status: "beta" as const,
    keyLabel: "QuickBooks Client ID",
    keyPlaceholder: "AB1cd2EFgh3...",
    features: [
      "Invoice sync",
      "Expense tracking",
      "Inventory valuation",
    ],
  },
];

// =============================================================================
// Global API Key Section (write-only — key is never read back to the client)
// =============================================================================

function GlobalApiKeySection() {
  const [apiKey, setApiKey] = useState("");
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [keyHint, setKeyHint] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
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
      setApiKey("");
      setIsEditing(false);
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

  if (!loaded) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClaudeIcon className="h-5 w-5 text-[#D97757]" />
          Anthropic Claude
        </CardTitle>
        <CardDescription>
          Configure Anthropic Claude for AI-powered assistance. This key is used as a fallback
          when individual users don&apos;t have their own key configured.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasExistingKey && !isEditing ? (
          <>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-green-600" />
                <span>Configured</span>
                {keyHint && (
                  <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    sk-ant-{keyHint}
                  </code>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => testKey.mutate()}
                  disabled={testKey.isPending}
                >
                  {testKey.isPending ? "Testing..." : "Test"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                >
                  Change
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => saveKey.mutate("")}
                  disabled={saveKey.isPending}
                >
                  Remove
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Users can override this with their own key in Brewery Settings.
            </p>
          </>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="global_api_key">Anthropic API Key</Label>
            <div className="flex gap-2">
              <Input
                id="global_api_key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-..."
                autoComplete="off"
              />
              <Button
                type="button"
                onClick={() => saveKey.mutate(apiKey)}
                disabled={!apiKey || saveKey.isPending}
              >
                {saveKey.isPending ? "Saving..." : "Save"}
              </Button>
              {hasExistingKey && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsEditing(false);
                    setApiKey("");
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Get your API key from{" "}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                console.anthropic.com
              </a>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// External Integrations
// =============================================================================

function getStatusBadge(status: "connected" | "beta" | "disconnected") {
  switch (status) {
    case "connected":
      return <Badge variant="default">Connected</Badge>;
    case "beta":
      return <Badge variant="secondary">Beta</Badge>;
    case "disconnected":
      return <Badge variant="outline">Not Connected</Badge>;
  }
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
  const [apiKey, setApiKey] = useState("");
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [keyHint, setKeyHint] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
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
      setApiKey("");
      setIsEditing(false);
      toast.success(key ? `${keyLabel} saved` : `${keyLabel} removed`);
    },
    onError: () => {
      toast.error(`Failed to save ${keyLabel}`);
    },
  });

  if (!loaded) return null;

  if (hasExistingKey && !isEditing) {
    return (
      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <div className="flex items-center gap-2 text-sm">
          <Check className="h-4 w-4 text-green-600" />
          <span>Configured</span>
          {keyHint && (
            <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {keyHint}
            </code>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsEditing(true)}
          >
            Change
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => saveKey.mutate("")}
            disabled={saveKey.isPending}
          >
            Remove
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <Label>{keyLabel}</Label>
      <div className="flex gap-2">
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={keyPlaceholder}
          autoComplete="off"
        />
        <Button
          type="button"
          onClick={() => saveKey.mutate(apiKey)}
          disabled={!apiKey || saveKey.isPending}
        >
          {saveKey.isPending ? "Saving..." : "Save"}
        </Button>
        {hasExistingKey && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setIsEditing(false);
              setApiKey("");
            }}
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
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

      {/* Integration Cards */}
      <div className="space-y-4">
        {integrations.map((integration) => {
          const Icon = integrationIcons[integration.id];
          return (
            <Card key={integration.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {Icon && <Icon className="h-5 w-5" />}
                      {integration.name}
                    </CardTitle>
                    <CardDescription>
                      {integration.description}
                    </CardDescription>
                  </div>
                  {getStatusBadge(integration.status)}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <IntegrationKeySection
                  integrationId={integration.id}
                  keyLabel={integration.keyLabel}
                  keyPlaceholder={integration.keyPlaceholder}
                />
                <div>
                  <h4 className="text-sm font-medium mb-2">Features</h4>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {integration.features.map((feature, index) => (
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
        })}
      </div>

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
