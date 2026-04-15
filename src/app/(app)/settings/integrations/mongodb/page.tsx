"use client";

/**
 * MongoDB Sync Settings Page
 *
 * Manages the MongoDB connection and sync operations.
 * Tabs: Connection, Sync, Log.
 */

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
import { IntegrationBadge } from "@/components/domain/integration-badge";
import { SecretKeyInput } from "@/components/domain/secret-key-input";
import {
  ArrowLeft,
  RefreshCw,
  Check,
  AlertCircle,
  Database,
  Loader2,
} from "lucide-react";
import { mongodbKeys } from "@/lib/query-keys";
import { formatDistanceToNow } from "date-fns";

// =============================================================================
// Connection Tab
// =============================================================================

function ConnectionTab() {
  const queryClient = useQueryClient();

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: mongodbKeys.status(),
    queryFn: async () => {
      const res = await fetch("/api/integrations/mongodb/status");
      return (await res.json()).data;
    },
  });

  const { data: keyInfo, isLoading: keyLoading } = useQuery({
    queryKey: mongodbKeys.apiKey(),
    queryFn: async () => {
      const res = await fetch("/api/settings/api-key?scope=integration&id=mongodb");
      return await res.json() as { hasKey: boolean; keyHint: string | null };
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (uri: string) => {
      const res = await fetch("/api/settings/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "integration", id: "mongodb", key: uri }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message || "Failed to save URI");
      }
    },
    onSuccess: () => {
      toast.success("MongoDB URI saved");
      queryClient.invalidateQueries({ queryKey: mongodbKeys.all() });
      queryClient.invalidateQueries({ queryKey: mongodbKeys.apiKey() });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "integration", id: "mongodb", key: "" }),
      });
      if (!res.ok) throw new Error("Failed to remove URI");
    },
    onSuccess: () => {
      toast.success("MongoDB URI removed");
      queryClient.invalidateQueries({ queryKey: mongodbKeys.all() });
      queryClient.invalidateQueries({ queryKey: mongodbKeys.apiKey() });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/integrations/mongodb/status");
      const json = await res.json();
      if (!json.data?.connected) throw new Error(json.data?.error || "Connection failed");
      return json.data;
    },
    onSuccess: (data) => {
      toast.success(`Connected to ${data.dbName}`);
      queryClient.invalidateQueries({ queryKey: mongodbKeys.status() });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (statusLoading || keyLoading) {
    return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <IntegrationBadge status={status?.connected ? "connected" : "not_connected"} />
          {status?.connected && status.dbName && (
            <span className="text-sm text-muted-foreground">Database: {status.dbName}</span>
          )}
        </div>
        {!status?.connected && status?.error && (
          <p className="text-sm text-destructive">{status.error}</p>
        )}
      </div>

      <SecretKeyInput
        label="MongoDB Connection URI"
        placeholder="mongodb+srv://user:pass@cluster.example.net/db"
        inputType="password"
        hintPrefix="mongodb"
        hasExistingKey={keyInfo?.hasKey ?? false}
        keyHint={keyInfo?.keyHint ?? null}
        isLoading={keyLoading}
        onSave={(uri) => saveMutation.mutate(uri)}
        onRemove={() => removeMutation.mutate()}
        isSaving={saveMutation.isPending || removeMutation.isPending}
        onTest={() => testMutation.mutate()}
        isTesting={testMutation.isPending}
        helpText="Connection string from MongoDB Atlas or your self-hosted instance."
      />
    </div>
  );
}

// =============================================================================
// Sync Tab
// =============================================================================

type PhaseConfig = {
  phase: number;
  title: string;
  entities: string;
  description: string;
}

const PHASES: PhaseConfig[] = [
  { phase: 1, title: "Catalog", entities: "suppliers, malts, hops, yeasts, styles", description: "Standalone ingredients and styles" },
  { phase: 2, title: "Brands & Vessels", entities: "beers→brands, vessels", description: "Depends on Phase 1 catalog data" },
  { phase: 3, title: "Production", entities: "batches, transfers, orders", description: "Depends on Phase 2 brands and vessels" },
  { phase: 4, title: "Readings", entities: "tests→batch_logs", description: "Depends on Phase 3 batches" },
];

function SyncTab() {
  const queryClient = useQueryClient();

  const { data: status } = useQuery({
    queryKey: mongodbKeys.status(),
    queryFn: async () => {
      const res = await fetch("/api/integrations/mongodb/status");
      return (await res.json()).data;
    },
  });

  const syncMutation = useMutation({
    mutationFn: async (opts: { phase?: number; clean?: boolean }) => {
      const res = await fetch("/api/integrations/mongodb/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Sync failed");
      return json.data;
    },
    onSuccess: (data) => {
      toast.success(`Synced ${data.totalSynced} records (${data.totalFailed} failed)`);
      queryClient.invalidateQueries({ queryKey: mongodbKeys.all() });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const isConnected = status?.connected ?? false;

  return (
    <div className="space-y-4">
      {!isConnected && (
        <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-600 dark:text-amber-400">
          Connect to MongoDB first in the Connection tab.
        </div>
      )}

      <div className="grid gap-3">
        {PHASES.map((p) => (
          <Card key={p.phase}>
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="font-medium">Phase {p.phase}: {p.title}</p>
                <p className="text-sm text-muted-foreground">{p.entities}</p>
                <p className="text-xs text-muted-foreground">{p.description}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!isConnected || syncMutation.isPending}
                onClick={() => syncMutation.mutate({ phase: p.phase })}
              >
                {syncMutation.isPending && syncMutation.variables?.phase === p.phase ? (
                  <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Syncing...</>
                ) : (
                  <><RefreshCw className="mr-1 h-3 w-3" /> Sync</>
                )}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-2">
        <Button
          className="flex-1"
          disabled={!isConnected || syncMutation.isPending}
          onClick={() => syncMutation.mutate({})}
        >
          {syncMutation.isPending && !syncMutation.variables?.clean && !syncMutation.variables?.phase ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Syncing All...</>
          ) : (
            <><RefreshCw className="mr-2 h-4 w-4" /> Sync All</>
          )}
        </Button>
        <Button
          className="flex-1"
          variant="outline"
          disabled={!isConnected || syncMutation.isPending}
          onClick={() => syncMutation.mutate({ clean: true })}
        >
          {syncMutation.isPending && syncMutation.variables?.clean ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cleaning + Syncing...</>
          ) : (
            <><RefreshCw className="mr-2 h-4 w-4" /> Clean + Sync All</>
          )}
        </Button>
      </div>
    </div>
  );
}

// =============================================================================
// Sync Log Tab
// =============================================================================

function SyncLogTab() {
  const { data: status, isLoading } = useQuery({
    queryKey: mongodbKeys.syncLog(),
    queryFn: async () => {
      const res = await fetch("/api/integrations/mongodb/status");
      return (await res.json()).data;
    },
  });

  const logs = status?.recentLogs ?? [];

  if (isLoading) {
    return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>;
  }

  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground">No sync history yet.</p>;
  }

  return (
    <div className="space-y-2">
      {logs.map((log: { id: string; status: string; entity_type: string; phase: number; records_synced: number; records_failed: number; started_at: string | null }) => (
        <div
          key={log.id}
          className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
        >
          <div className="flex items-center gap-2">
            {log.status === "success" && <Check className="h-4 w-4 text-green-500" />}
            {log.status === "error" && <AlertCircle className="h-4 w-4 text-red-500" />}
            {log.status === "pending" && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
            <span className="font-medium">{log.entity_type}</span>
            <span className="text-muted-foreground">Phase {log.phase}</span>
          </div>
          <div className="flex items-center gap-3 text-muted-foreground">
            <span>{log.records_synced} synced</span>
            {log.records_failed > 0 && (
              <span className="text-red-500">{log.records_failed} failed</span>
            )}
            {log.started_at && (
              <span className="text-xs">
                {formatDistanceToNow(new Date(log.started_at), { addSuffix: true })}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// Main Page
// =============================================================================

export default function MongoDBSettingsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/settings/integrations">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-3">
          <Database className="h-6 w-6" />
          <div>
            <h1 className="text-2xl font-semibold">MongoDB Sync</h1>
            <p className="text-sm text-muted-foreground">
              Sync data from lolev-manager (MongoDB) into MGR
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>
            Connect to MongoDB and sync catalog, production, and order data.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="connection">
            <TabsList>
              <TabsTrigger value="connection">Connection</TabsTrigger>
              <TabsTrigger value="sync">Sync</TabsTrigger>
              <TabsTrigger value="log">Log</TabsTrigger>
            </TabsList>
            <TabsContent value="connection" className="mt-4">
              <ConnectionTab />
            </TabsContent>
            <TabsContent value="sync" className="mt-4">
              <SyncTab />
            </TabsContent>
            <TabsContent value="log" className="mt-4">
              <SyncLogTab />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
