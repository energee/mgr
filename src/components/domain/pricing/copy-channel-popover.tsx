"use client";

/**
 * Copy Channel Popover
 *
 * Toolbar popover for the pricing matrix: copies all prices from another
 * sales channel into the active one. Writes all rows in a single batched
 * upsert (keyed on the pricing_tier_id/format_id/sales_channel_id unique
 * constraint), overwriting any existing prices.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { settingsKeys } from "@/lib/query-keys";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy } from "lucide-react";
import { log } from "@/lib/client-logger";
import type { SalesChannel } from "@/components/domain/pricing/types";

export function CopyChannelPopover({
  channels,
  activeChannelId,
  activeChannelName,
}: {
  channels: SalesChannel[];
  activeChannelId: string | null;
  activeChannelName: string | undefined;
}) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const [copyOpen, setCopyOpen] = useState(false);
  const [copyFromChannel, setCopyFromChannel] = useState<string>("");

  const copyChannelMutation = useMutation({
    mutationFn: async ({
      fromChannelId,
      toChannelId,
    }: {
      fromChannelId: string;
      toChannelId: string;
    }) => {
      const { data: sourcePrices, error: fetchError } = await supabase
        .from("pricing_tier_prices")
        .select("pricing_tier_id, format_id, price")
        .eq("sales_channel_id", fromChannelId);
      if (fetchError) throw fetchError;

      if (!sourcePrices?.length) {
        toast.error("Source channel has no prices");
        return;
      }

      const updatedAt = new Date().toISOString();
      // One batched upsert for all copied prices instead of N round trips.
      const { error } = await supabase.from("pricing_tier_prices").upsert(
        sourcePrices.map((sp) => ({
          pricing_tier_id: sp.pricing_tier_id,
          format_id: sp.format_id,
          sales_channel_id: toChannelId,
          price: sp.price,
          updated_at: updatedAt,
        })),
        { onConflict: "pricing_tier_id,format_id,sales_channel_id" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: settingsKeys.pricingMatrix(activeChannelId ?? undefined),
      });
      toast.success("Prices copied");
      setCopyOpen(false);
      setCopyFromChannel("");
    },
    onError: (error) => {
      log.error("Copy channel failed:", error);
      toast.error("Failed to copy prices");
    },
  });

  return (
    <Popover open={copyOpen} onOpenChange={setCopyOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Copy className="h-4 w-4 mr-1" />
          Copy From
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="end">
        <div className="space-y-3">
          <h4 className="font-medium text-sm">
            Copy prices into {activeChannelName}
          </h4>
          <div>
            <Label className="text-xs">Source channel</Label>
            <Select
              value={copyFromChannel}
              onValueChange={setCopyFromChannel}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select channel..." />
              </SelectTrigger>
              <SelectContent>
                {channels
                  .filter((c) => c.id !== activeChannelId)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Existing prices will be overwritten
          </p>
          <Button
            size="sm"
            className="w-full"
            disabled={!copyFromChannel || copyChannelMutation.isPending}
            onClick={() => {
              if (!activeChannelId || !copyFromChannel) return;
              copyChannelMutation.mutate({
                fromChannelId: copyFromChannel,
                toChannelId: activeChannelId,
              });
            }}
          >
            {copyChannelMutation.isPending ? "Copying..." : "Copy Prices"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
