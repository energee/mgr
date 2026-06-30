"use client";

/**
 * Bulk Adjust Popover
 *
 * Toolbar popover for the pricing matrix: applies a percent or flat ($)
 * adjustment to every price in the active sales channel. All adjusted rows
 * are written back in a single batched upsert (keyed on the
 * pricing_tier_id/format_id/sales_channel_id unique constraint).
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { settingsKeys } from "@/lib/query-keys";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Percent } from "lucide-react";
import { log } from "@/lib/client-logger";

export function BulkAdjustPopover({
  channelId,
  channelName,
}: {
  channelId: string | null;
  channelName: string | undefined;
}) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkType, setBulkType] = useState<"percent" | "flat">("percent");
  const [bulkValue, setBulkValue] = useState("");

  const bulkAdjustMutation = useMutation({
    mutationFn: async ({
      type,
      amount,
      channelId,
    }: {
      type: "percent" | "flat";
      amount: number;
      channelId: string;
    }) => {
      const { data: channelPrices, error: fetchError } = await supabase
        .from("pricing_tier_prices")
        .select("pricing_tier_id, format_id, sales_channel_id, price")
        .eq("sales_channel_id", channelId);
      if (fetchError) throw fetchError;

      const updatedAt = new Date().toISOString();
      // Compute new prices client-side, skipping any that would go negative,
      // then write all rows in one batched upsert instead of N round trips.
      const rows = (channelPrices || [])
        .map((p) => ({
          pricing_tier_id: p.pricing_tier_id,
          format_id: p.format_id,
          sales_channel_id: p.sales_channel_id,
          price:
            type === "percent"
              ? Math.round(p.price * (1 + amount / 100) * 100) / 100
              : Math.round((p.price + amount) * 100) / 100,
          updated_at: updatedAt,
        }))
        .filter((r) => r.price >= 0);
      if (!rows.length) return;

      const { error } = await supabase
        .from("pricing_tier_prices")
        .upsert(rows, { onConflict: "pricing_tier_id,format_id,sales_channel_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: settingsKeys.pricingMatrix(channelId ?? undefined),
      });
      toast.success("Prices adjusted");
      setBulkOpen(false);
      setBulkValue("");
    },
    onError: (error) => {
      log.error("Bulk adjust failed:", error);
      toast.error("Failed to adjust prices");
    },
  });

  return (
    <Popover open={bulkOpen} onOpenChange={setBulkOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Percent className="h-4 w-4 mr-1" />
          Bulk Adjust
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        <div className="space-y-3">
          <h4 className="font-medium text-sm">
            Adjust all prices in {channelName}
          </h4>
          <div className="flex gap-2">
            <Select
              value={bulkType}
              onValueChange={(v) =>
                setBulkType(v as "percent" | "flat")
              }
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">Percent</SelectItem>
                <SelectItem value="flat">Flat ($)</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="number"
              step="0.01"
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
              placeholder={bulkType === "percent" ? "e.g., 5" : "e.g., 2.00"}
              className="flex-1"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {bulkType === "percent"
              ? "Enter positive to increase, negative to decrease"
              : "Enter positive to add, negative to subtract"}
          </p>
          <Button
            size="sm"
            className="w-full"
            disabled={!bulkValue || bulkAdjustMutation.isPending}
            onClick={() => {
              const amount = parseFloat(bulkValue);
              if (isNaN(amount) || !channelId) return;
              bulkAdjustMutation.mutate({
                type: bulkType,
                amount,
                channelId,
              });
            }}
          >
            {bulkAdjustMutation.isPending ? "Applying..." : "Apply"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
