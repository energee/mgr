"use client";

/**
 * Format Management
 *
 * "Formats" view of the pricing page: per-channel toggles (channel_formats)
 * controlling which selling formats appear in the pricing matrix.
 */

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { settingsKeys, channelFormatKeys } from "@/lib/query-keys";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { formatVolumeLabel } from "@/hooks/use-catalog";
import type {
  ChannelFormat,
  SalesChannel,
  SellingFormatWithContainer,
} from "@/components/domain/pricing/types";

export function FormatManagement({
  channels,
  activeChannelId,
  onChannelChange,
}: {
  channels: SalesChannel[];
  activeChannelId: string | null;
  onChannelChange: (id: string) => void;
}) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  // All active selling formats with container info
  const { data: formats, isLoading: formatsLoading } = useQuery({
    queryKey: settingsKeys.pricingFormatsAll(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("packaging_formats")
        .select("id, name, container_name, container_type, container_id, unit_count, volume_oz, volume_bbl")
        .eq("is_active", true)
        .order("container_type")
        .order("name");
      if (error) throw error;
      return data as SellingFormatWithContainer[];
    },
  });

  // All channel_formats entries
  const { data: channelFormats } = useQuery({
    queryKey: channelFormatKeys.all(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("channel_formats")
        .select("id, selling_format_id, sales_channel_id");
      if (error) throw error;
      return data as ChannelFormat[];
    },
  });

  // Build lookup: `${formatId}:${channelId}` -> channel_format row
  const cfMap = useMemo(() => {
    const map = new Map<string, ChannelFormat>();
    channelFormats?.forEach((cf) => {
      map.set(`${cf.selling_format_id}:${cf.sales_channel_id}`, cf);
    });
    return map;
  }, [channelFormats]);

  const toggleMutation = useMutation({
    mutationFn: async ({
      sellingFormatId,
      salesChannelId,
      enabled,
    }: {
      sellingFormatId: string;
      salesChannelId: string;
      enabled: boolean;
    }) => {
      if (enabled) {
        const { error } = await supabase.from("channel_formats").insert({
          selling_format_id: sellingFormatId,
          sales_channel_id: salesChannelId,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("channel_formats")
          .delete()
          .eq("selling_format_id", sellingFormatId)
          .eq("sales_channel_id", salesChannelId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: channelFormatKeys.all() });
      queryClient.invalidateQueries({ queryKey: settingsKeys.pricingFormats() });
    },
    // channel_formats drives which formats are exposed per channel (feeds the
    // pricing matrix and the Square catalog push) — a failed write must not
    // look like a saved toggle (audit UI-7/SF-8).
    onError: (_error, { enabled }) => {
      toast.error(
        enabled
          ? "Failed to enable format for channel"
          : "Failed to disable format for channel"
      );
    },
  });

  // Group formats by container
  const byContainer = useMemo(() => {
    const map = new Map<string, SellingFormatWithContainer[]>();
    formats?.forEach((f) => {
      const key = f.container_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(f);
    });
    return map;
  }, [formats]);

  if (formatsLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      {/* Channel tabs */}
      <Tabs
        value={activeChannelId ?? undefined}
        onValueChange={onChannelChange}
      >
        <TabsList>
          {channels.map((ch) => (
            <TabsTrigger key={ch.id} value={ch.id}>
              {ch.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <p className="text-sm text-muted-foreground">
        Toggle which selling formats appear in the pricing matrix for each sales channel.
      </p>
      {Array.from(byContainer.entries()).map(([containerId, containerFormats]) => (
        <div key={containerId} className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            {containerFormats[0].container_name} ({containerFormats[0].container_type})
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Format</TableHead>
                <TableHead>Units</TableHead>
                {channels?.map((ch) => (
                  <TableHead key={ch.id} className="w-[80px] text-center">
                    {ch.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {containerFormats.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">{f.name}</TableCell>
                  <TableCell className="text-muted-foreground">{formatVolumeLabel(f) ?? f.unit_count}</TableCell>
                  {channels?.map((ch) => {
                    const isEnabled = cfMap.has(`${f.id}:${ch.id}`);
                    return (
                      <TableCell key={ch.id} className="text-center">
                        <Switch
                          checked={isEnabled}
                          onCheckedChange={(checked) =>
                            toggleMutation.mutate({
                              sellingFormatId: f.id,
                              salesChannelId: ch.id,
                              enabled: checked,
                            })
                          }
                          disabled={toggleMutation.isPending}
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  );
}
