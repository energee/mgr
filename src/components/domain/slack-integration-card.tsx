"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { settingsKeys } from "@/lib/query-keys";
import { SecretKeyInput } from "@/components/domain/secret-key-input";
import { SlackIcon } from "@/components/ui/slack-icon";
import {
  Loader2,
  ExternalLink,
} from "lucide-react";

// Notification types with friendly labels
const NOTIFICATION_TYPES = [
  { type: "batch_status", label: "Batch Status Changes", defaultChannel: "#production" },
  { type: "order_received", label: "New Orders", defaultChannel: "#sales" },
  { type: "order_status", label: "Order Status Changes", defaultChannel: "#sales" },
  { type: "po_status", label: "Purchase Order Updates", defaultChannel: "#purchasing" },
  { type: "inventory_low", label: "Low Inventory Alerts", defaultChannel: "#inventory" },
  { type: "system", label: "System Notifications", defaultChannel: "" },
] as const;

interface SlackSettingsResponse {
  webhook_url_masked: string | null;
  has_webhook: boolean;
  default_channel: string | null;
  is_enabled: boolean;
  channel_overrides: Record<string, string>;
}

function ConnectionBadge({
  isConnected,
  isEnabled,
}: {
  isConnected: boolean;
  isEnabled: boolean;
}) {
  if (!isConnected) {
    return <Badge variant="outline">Not Connected</Badge>;
  }
  if (isEnabled) {
    return <Badge variant="default">Active</Badge>;
  }
  return <Badge variant="outline">Connected</Badge>;
}

export function SlackIntegrationCard() {
  const queryClient = useQueryClient();
  const [defaultChannel, setDefaultChannel] = useState("");
  const [channelOverrides, setChannelOverrides] = useState<Record<string, string>>({});
  const [hasInitialized, setHasInitialized] = useState(false);

  const {
    data: settings,
    isLoading,
  } = useQuery<SlackSettingsResponse>({
    queryKey: settingsKeys.slackSettings(),
    queryFn: async () => {
      const res = await fetch("/api/slack/settings");
      if (!res.ok) throw new Error("Failed to load Slack settings");
      return res.json();
    },
  });

  // Initialize local state from fetched settings
  if (settings && !hasInitialized) {
    setDefaultChannel(settings.default_channel ?? "");
    setChannelOverrides(settings.channel_overrides ?? {});
    setHasInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/slack/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to save");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.slackSettings() });
      toast.success("Slack settings saved");
    },
    onError: (err) => {
      toast.error(`Failed to save: ${err.message}`);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch("/api/slack/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_enabled: enabled }),
      });
      if (!res.ok) throw new Error("Failed to toggle");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.slackSettings() });
    },
    onError: () => {
      toast.error("Failed to toggle Slack notifications");
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/slack/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Test failed");
    },
    onSuccess: () => {
      toast.success("Test message sent to Slack!");
    },
    onError: (err) => {
      toast.error(`Slack test failed: ${err.message}`);
    },
  });

  const handleSaveChannels = () => {
    // Filter out empty channel overrides
    const cleaned = Object.fromEntries(
      Object.entries(channelOverrides).filter(([, v]) => v.trim() !== ""),
    );
    saveMutation.mutate({
      default_channel: defaultChannel.trim() || null,
      channel_overrides: cleaned,
    });
  };

  const handleChannelOverrideChange = (type: string, channel: string) => {
    setChannelOverrides((prev) => ({ ...prev, [type]: channel }));
  };

  const isConnected = settings?.has_webhook ?? false;
  const isEnabled = settings?.is_enabled ?? false;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted">
              <SlackIcon className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-lg">Slack</CardTitle>
              <CardDescription>
                Send notifications to Slack channels for batch status changes, orders, inventory alerts, and more.
              </CardDescription>
            </div>
          </div>
          <ConnectionBadge isConnected={isConnected} isEnabled={isEnabled} />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Webhook URL Section */}
        <SecretKeyInput
          label="Webhook URL"
          placeholder="https://hooks.slack.com/services/..."
          inputType="url"
          isLoading={isLoading}
          hasExistingKey={isConnected}
          keyHint={settings?.webhook_url_masked}
          onSave={(url) => saveMutation.mutate({ webhook_url: url })}
          onRemove={() => saveMutation.mutate({ webhook_url: null, is_enabled: false })}
          isSaving={saveMutation.isPending}
          onTest={isConnected ? () => testMutation.mutate() : undefined}
          isTesting={testMutation.isPending}
          helpText={
            <>
              Create an{" "}
              <a
                href="https://api.slack.com/messaging/webhooks"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                Incoming Webhook <ExternalLink className="inline h-3 w-3" />
              </a>{" "}
              in your Slack workspace settings.
            </>
          }
        />

        {isConnected && (
          <>
            <Separator />

            {/* Enable/Disable */}
            <div className="flex items-center gap-3">
              <Switch
                checked={isEnabled}
                onCheckedChange={(checked) => toggleMutation.mutate(checked)}
                disabled={toggleMutation.isPending}
              />
              <Label className="text-sm">
                {isEnabled ? "Notifications enabled" : "Notifications disabled"}
              </Label>
            </div>

            <Separator />

            {/* Default Channel */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Default Channel</Label>
              <Input
                placeholder="#general"
                value={defaultChannel}
                onChange={(e) => setDefaultChannel(e.target.value)}
                className="max-w-xs"
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to use the webhook&apos;s default channel.
              </p>
            </div>

            {/* Channel Overrides */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Channel Routing</Label>
              <p className="text-xs text-muted-foreground">
                Route specific notification types to different channels. Leave empty to use the default channel.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Notification Type</TableHead>
                    <TableHead>Channel</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {NOTIFICATION_TYPES.map((nt) => (
                    <TableRow key={nt.type}>
                      <TableCell className="text-sm">{nt.label}</TableCell>
                      <TableCell>
                        <Input
                          placeholder={nt.defaultChannel || "(default)"}
                          value={channelOverrides[nt.type] ?? ""}
                          onChange={(e) =>
                            handleChannelOverrideChange(nt.type, e.target.value)
                          }
                          className="max-w-[200px] h-8"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Button
                size="sm"
                onClick={handleSaveChannels}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                )}
                Save Channel Settings
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
