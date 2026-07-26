"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ArrowLeft, RefreshCw, Check, AlertCircle } from "lucide-react";
import { QuickBooksIcon } from "@/components/ui/quickbooks-icon";
import { qboKeys } from "@/lib/query-keys";
import { formatDistanceToNow } from "date-fns";

// ============================================================================
// Connection Tab
// ============================================================================

function ConnectionTab() {
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery({
    queryKey: qboKeys.status(),
    queryFn: async () => {
      const res = await fetch("/api/integrations/quickbooks/status");
      return (await res.json()).data;
    },
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/integrations/quickbooks/auth");
      const json = await res.json();
      if (!res.ok)
        throw new Error(json.error?.message || "Failed to generate auth URL");
      return json.data.url;
    },
    onSuccess: (url: string) => {
      window.location.href = url;
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/integrations/quickbooks/disconnect", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to disconnect");
    },
    onSuccess: () => {
      toast.success("Disconnected from QuickBooks");
      queryClient.invalidateQueries({ queryKey: qboKeys.all() });
    },
  });

  const autoSyncMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch("/api/integrations/quickbooks/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_sync_enabled: enabled }),
      });
      if (!res.ok) throw new Error("Failed to update auto-sync setting");
      return (await res.json()).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qboKeys.status() });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  if (isLoading)
    return <div className="text-sm text-muted-foreground">Loading...</div>;

  if (status?.connected) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-md border px-4 py-3">
          <div className="flex items-center gap-3">
            <Check className="h-5 w-5 text-green-600" />
            <div>
              <div className="text-sm font-medium">
                Connected to {status.companyName || "QuickBooks"}
              </div>
              <div className="text-xs text-muted-foreground">
                Realm ID: {status.realmId} | Environment: {status.environment}
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => disconnectMutation.mutate()}
            disabled={disconnectMutation.isPending}
          >
            {disconnectMutation.isPending ? "Disconnecting..." : "Disconnect"}
          </Button>
        </div>

        <div className="flex items-center justify-between rounded-md border px-4 py-3">
          <div>
            <Label className="text-sm font-medium">Auto-sync</Label>
            <p className="text-xs text-muted-foreground">
              Automatically sync invoices and bills when orders/POs are fulfilled
            </p>
          </div>
          <Switch
            checked={status.autoSyncEnabled ?? false}
            onCheckedChange={(checked) => autoSyncMutation.mutate(checked)}
            disabled={autoSyncMutation.isPending}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Connect your QuickBooks Online account to automatically sync invoices
        and bills. Configure your Client ID and Client Secret in the integration
        settings first.
      </p>
      <Button
        onClick={() => connectMutation.mutate()}
        disabled={connectMutation.isPending}
      >
        <QuickBooksIcon className="h-4 w-4 mr-2" />
        {connectMutation.isPending ? "Connecting..." : "Connect to QuickBooks"}
      </Button>
    </div>
  );
}

// ============================================================================
// Account Mapping Tab
// ============================================================================

const CATEGORIES = [
  { key: "sales_revenue", label: "Sales Revenue" },
  { key: "cogs", label: "Cost of Goods Sold" },
  { key: "shipping", label: "Shipping Expense" },
  { key: "accounts_receivable", label: "Accounts Receivable" },
  { key: "accounts_payable", label: "Accounts Payable" },
];

function AccountMappingTab() {
  const { data, isLoading } = useQuery({
    queryKey: qboKeys.accounts(),
    queryFn: async () => {
      const res = await fetch("/api/integrations/quickbooks/accounts");
      if (!res.ok) return { accounts: [], mappings: [] };
      return (await res.json()).data;
    },
  });

  const queryClient = useQueryClient();
  const saveMutation = useMutation({
    mutationFn: async (
      mappings: {
        category: string;
        qbo_account_id: string;
        qbo_account_name: string;
      }[]
    ) => {
      const res = await fetch("/api/integrations/quickbooks/accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mappings }),
      });
      if (!res.ok) throw new Error("Failed to save mappings");
    },
    onSuccess: () => {
      toast.success("Account mappings saved");
      queryClient.invalidateQueries({ queryKey: qboKeys.accounts() });
    },
  });

  const accounts = data?.accounts || [];
  const currentMappings = data?.mappings || [];

  const [localMappings, setLocalMappings] = useState<
    Record<string, { id: string; name: string }>
  >({});

  // Initialize local state from server data
  const mappingMap = Object.fromEntries(
    currentMappings.map(
      (m: {
        category: string;
        qbo_account_id: string;
        qbo_account_name: string;
      }) => [m.category, { id: m.qbo_account_id, name: m.qbo_account_name }]
    )
  );

  const effectiveMappings = { ...mappingMap, ...localMappings };

  const handleSave = () => {
    const toSave = CATEGORIES.filter(
      (c) => effectiveMappings[c.key]?.id
    ).map((c) => ({
      category: c.key,
      qbo_account_id: effectiveMappings[c.key].id,
      qbo_account_name: effectiveMappings[c.key].name,
    }));
    saveMutation.mutate(toSave);
  };

  if (isLoading)
    return (
      <div className="text-sm text-muted-foreground">Loading accounts...</div>
    );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Map MGR categories to your QuickBooks chart of accounts.
      </p>
      <div className="space-y-3">
        {CATEGORIES.map((cat) => (
          <div key={cat.key} className="flex items-center gap-4">
            <Label className="w-48 text-sm">{cat.label}</Label>
            <Select
              value={effectiveMappings[cat.key]?.id || ""}
              onValueChange={(value) => {
                const account = accounts.find(
                  (a: { Id: string }) => a.Id === value
                );
                setLocalMappings((prev) => ({
                  ...prev,
                  [cat.key]: { id: value, name: account?.Name || "" },
                }));
              }}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Select account..." />
              </SelectTrigger>
              <SelectContent>
                {accounts.map(
                  (account: {
                    Id: string;
                    Name: string;
                    AccountType: string;
                  }) => (
                    <SelectItem key={account.Id} value={account.Id}>
                      {account.Name} ({account.AccountType})
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      <Button onClick={handleSave} disabled={saveMutation.isPending}>
        {saveMutation.isPending ? "Saving..." : "Save Mappings"}
      </Button>
    </div>
  );
}

// ============================================================================
// Sync Log Tab
// ============================================================================

const PAGE_SIZE = 20;

function SyncLogTab() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset visible count when filter changes
  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    setVisibleCount(PAGE_SIZE);
  };

  // A failed read must render an error arm, not "No sync activity yet" — the
  // latter hides every error row and its retry button behind a reassuring
  // empty state.
  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: qboKeys.syncLog({
      ...(statusFilter && statusFilter !== "all"
        ? { status: statusFilter }
        : {}),
      limit: visibleCount,
    }),
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(visibleCount),
        offset: "0",
      });
      if (statusFilter && statusFilter !== "all")
        params.set("status", statusFilter);
      const res = await fetch(
        `/api/integrations/quickbooks/sync-log?${params}`
      );
      if (!res.ok) throw new Error("Failed to read QuickBooks sync log");
      return (await res.json()).data;
    },
    placeholderData: (prev) => prev,
  });

  const queryClient = useQueryClient();
  const retryMutation = useMutation({
    mutationFn: async (syncLogId: string) => {
      const res = await fetch("/api/integrations/quickbooks/sync/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncLogId }),
      });
      if (!res.ok) throw new Error("Retry failed");
    },
    onSuccess: () => {
      toast.success("Retry successful");
      queryClient.invalidateQueries({ queryKey: qboKeys.syncLog() });
    },
    onError: (err: Error) => {
      toast.error(`Retry failed: ${err.message}`);
    },
  });

  const logs = data?.logs || [];
  const total = data?.total || 0;
  const hasMore = logs.length < total;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Select value={statusFilter} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
        {total > 0 && (
          <span className="text-xs text-muted-foreground">
            Showing {logs.length} of {total}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : isError ? (
        <div className="text-sm text-destructive py-8 text-center">
          Could not load the sync log. Sync activity is unknown — retry in a
          moment.
        </div>
      ) : logs.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          No sync activity yet
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map(
            (log: {
              id: string;
              entity_type: string;
              entity_id: string;
              action: string;
              status: string;
              error_message?: string;
              created_at: string;
            }) => (
              <div
                key={log.id}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-3">
                  {log.status === "success" ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : log.status === "error" ? (
                    <AlertCircle className="h-4 w-4 text-red-600" />
                  ) : (
                    <RefreshCw className="h-4 w-4 text-muted-foreground animate-spin" />
                  )}
                  <div>
                    <span className="font-medium">{log.entity_type}</span>
                    <span className="text-muted-foreground mx-1">&middot;</span>
                    <span className="text-muted-foreground">{log.action}</span>
                    {log.error_message && (
                      <p className="text-xs text-red-600 mt-0.5">
                        {log.error_message}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(log.created_at), {
                      addSuffix: true,
                    })}
                  </span>
                  {log.status === "error" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => retryMutation.mutate(log.id)}
                      disabled={retryMutation.isPending}
                    >
                      Retry
                    </Button>
                  )}
                </div>
              </div>
            )
          )}

          {hasMore && (
            <div className="pt-2 text-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                disabled={isFetching}
              >
                {isFetching ? "Loading..." : "Load More"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function QuickBooksSettingsPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/settings/integrations">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">
            QuickBooks Online
          </h1>
          <p className="text-muted-foreground">
            Manage your QuickBooks connection, account mappings, and sync history
          </p>
        </div>
      </div>

      <Tabs defaultValue="connection">
        <TabsList>
          <TabsTrigger value="connection">Connection</TabsTrigger>
          <TabsTrigger value="accounts">Account Mapping</TabsTrigger>
          <TabsTrigger value="sync-log">Sync Log</TabsTrigger>
        </TabsList>

        <TabsContent value="connection" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Connection</CardTitle>
              <CardDescription>
                Connect and manage your QuickBooks Online account
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ConnectionTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accounts" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Account Mapping</CardTitle>
              <CardDescription>
                Map MGR categories to your QuickBooks chart of accounts
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AccountMappingTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sync-log" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Sync Log</CardTitle>
              <CardDescription>
                View sync history and retry failed syncs
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SyncLogTab />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
