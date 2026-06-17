"use client";

/**
 * BrewLogLinker - Link Batches to Brew Logs
 *
 * Manages the brew_log_batches junction table to connect batches to brew days.
 * Supports:
 * - 1:1 (standard brewing)
 * - 1:many (split fermentation)
 * - many:1 (blending)
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link2, Plus, Trash2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { batchKeys } from "@/lib/query-keys";
import { unwrap } from "@/lib/supabase/query-helpers";
import { UnitDisplay, UnitInput } from "@/components/ui/unit-input";

type BrewLog = {
  id: string;
  brew_number: string;
  brew_date: string;
  status: string;
}

type LinkedBrewLog = {
  id: string;
  brew_log_id: string;
  batch_id: string;
  volume_bbl: number;
  notes: string | null;
  brew_log: BrewLog;
}

type BrewLogLinkerProps = {
  batchId: string;
  batchName: string;
}

export function BrewLogLinker({ batchId, batchName }: BrewLogLinkerProps) {
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [selectedBrewLogId, setSelectedBrewLogId] = useState("");
  const [volume, setVolume] = useState<number | null>(null);
  const [notes, setNotes] = useState("");

  const supabase = createClient();
  const queryClient = useQueryClient();

  // Fetch existing links
  const { data: linkedBrewLogs = [], isLoading } = useQuery({
    queryKey: batchKeys.brewLogs(batchId),
    queryFn: async () =>
      (await unwrap(
        supabase
          .from("brew_log_batches")
          .select(`
          id,
          brew_log_id,
          batch_id,
          volume_bbl,
          notes,
          brew_log:brew_logs(
            id,
            brew_number,
            brew_date,
            status
          )
        `)
          .eq("batch_id", batchId)
      ) ?? []) as unknown as LinkedBrewLog[],
  });

  // Fetch available brew logs (completed, not already linked to this batch)
  const { data: availableBrewLogs = [] } = useQuery({
    queryKey: batchKeys.availableBrewLogs(batchId),
    queryFn: async () => {
      const data = await unwrap(
        supabase
          .from("brew_logs")
          .select("id, brew_number, brew_date, status")
          .eq("status", "completed")
          .order("brew_date", { ascending: false })
          .limit(50)
      );

      // Filter out already linked
      const linkedIds = linkedBrewLogs.map((l) => l.brew_log_id);
      return (data ?? []).filter(
        (bl) => !linkedIds.includes(bl.id)
      ) as unknown as BrewLog[];
    },
    enabled: linkDialogOpen,
  });

  // Link mutation
  const linkMutation = useMutation({
    mutationFn: async ({
      brewLogId,
      volumeBbl,
      linkNotes,
    }: {
      brewLogId: string;
      volumeBbl: number;
      linkNotes: string;
    }) => {
      await unwrap(
        supabase.from("brew_log_batches").insert({
          brew_log_id: brewLogId,
          batch_id: batchId,
          volume_bbl: volumeBbl,
          notes: linkNotes || null,
        })
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: batchKeys.brewLogs(batchId) });
      queryClient.invalidateQueries({ queryKey: batchKeys.detail(batchId) });
      setLinkDialogOpen(false);
      setSelectedBrewLogId("");
      setVolume(null);
      setNotes("");
      toast.success("Brew log linked");
    },
    onError: (error) => {
      toast.error("Failed to link brew log", { description: error.message });
    },
  });

  // Unlink mutation
  const unlinkMutation = useMutation({
    mutationFn: async (linkId: string) => {
      await unwrap(
        supabase
          .from("brew_log_batches")
          .delete()
          .eq("id", linkId)
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: batchKeys.brewLogs(batchId) });
      queryClient.invalidateQueries({ queryKey: batchKeys.detail(batchId) });
      toast.success("Brew log unlinked");
    },
    onError: (error) => {
      toast.error("Failed to unlink", { description: error.message });
    },
  });

  const handleLink = () => {
    if (!selectedBrewLogId || volume == null || volume <= 0) return;
    linkMutation.mutate({
      brewLogId: selectedBrewLogId,
      volumeBbl: volume,
      linkNotes: notes,
    });
  };

  if (isLoading) {
    return <div className="animate-pulse h-24 bg-muted rounded-md" />;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Link2 className="h-4 w-4" />
          Linked Brew Logs
        </CardTitle>
        <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus className="h-4 w-4 mr-1" />
              Link Brew
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Link Brew Log</DialogTitle>
              <DialogDescription>
                Connect a completed brew to {batchName}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Brew Log</Label>
                <Select
                  value={selectedBrewLogId}
                  onValueChange={setSelectedBrewLogId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a brew..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableBrewLogs.map((bl) => (
                      <SelectItem key={bl.id} value={bl.id}>
                        {bl.brew_number} (
                        {new Date(bl.brew_date).toLocaleDateString()})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Volume</Label>
                <UnitInput
                  value={volume}
                  onChange={setVolume}
                  unitType="volume"
                  decimals={2}
                  placeholder="e.g., 10.5"
                />
              </div>
              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Input
                  placeholder="e.g., first runnings, split ferment"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setLinkDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleLink}
                disabled={!selectedBrewLogId || volume == null || volume <= 0 || linkMutation.isPending}
              >
                {linkMutation.isPending ? "Linking..." : "Link"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {linkedBrewLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No brew logs linked yet. Link a completed brew to track hot-side data.
          </p>
        ) : (
          <div className="space-y-3">
            {linkedBrewLogs.map((link, idx) => (
              <div
                key={link.id ?? `link-${idx}`}
                className="flex items-center justify-between p-3 rounded-md border"
              >
                <Link
                  href={`/production/brew-logs/${link.brew_log_id}`}
                  className="flex-1 group"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium group-hover:text-primary transition-colors">
                      {link.brew_log.brew_number}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      <UnitDisplay value={link.volume_bbl} unitType="volume" />
                    </Badge>
                    <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {new Date(link.brew_log.brew_date).toLocaleDateString()}
                  </div>
                  {link.notes && (
                    <div className="text-sm text-muted-foreground mt-1">
                      {link.notes}
                    </div>
                  )}
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault();
                    if (confirm("Unlink this brew log?")) {
                      unlinkMutation.mutate(link.id);
                    }
                  }}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
