"use client";

/**
 * Pricing Matrix View
 *
 * "Matrix" view of the pricing page: spreadsheet-like grid of prices with
 * channel tabs across the top, pricing tiers as rows, and the active
 * channel's visible selling formats as columns. Handles inline cell editing
 * (PriceCell) with Tab/Enter/Arrow keyboard-grid navigation, plus the
 * bulk-adjust and copy-channel toolbar actions. Falls back to stacked
 * cards (PricingMobileCards) on narrow viewports.
 */

import { useCallback, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { settingsKeys, channelFormatKeys } from "@/lib/query-keys";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { DollarSign } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { log } from "@/lib/client-logger";
import { PriceCell } from "@/components/domain/pricing/price-cell";
import { PricingMobileCards } from "@/components/domain/pricing/pricing-mobile-cards";
import { BulkAdjustPopover } from "@/components/domain/pricing/bulk-adjust-popover";
import { CopyChannelPopover } from "@/components/domain/pricing/copy-channel-popover";
import type {
  FormatGroup,
  NavigateDirection,
  PricingTier,
  PricingTierPrice,
  SalesChannel,
  SellingFormatWithContainer,
} from "@/components/domain/pricing/types";

export function PricingMatrixView({
  channels,
  tiers,
  allFormats,
  activeChannelId,
  onChannelChange,
  onShowFormats,
}: {
  channels: SalesChannel[];
  tiers: PricingTier[] | undefined;
  allFormats: SellingFormatWithContainer[] | undefined;
  activeChannelId: string | null;
  onChannelChange: (id: string) => void;
  /** Switch the page to the Formats view (used by the empty state) */
  onShowFormats: () => void;
}) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const activeChannelName = channels.find((c) => c.id === activeChannelId)?.name;

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  // Fetch channel_formats for the active channel to determine visible formats
  const { data: activeChannelFormats } = useQuery({
    queryKey: channelFormatKeys.byChannel(activeChannelId ?? ""),
    queryFn: async () => {
      if (!activeChannelId) return [];
      const { data, error } = await supabase
        .from("channel_formats")
        .select("selling_format_id")
        .eq("sales_channel_id", activeChannelId);
      if (error) throw error;
      return data.map((d) => d.selling_format_id);
    },
    enabled: !!activeChannelId,
  });

  // Filter to only formats visible in the active channel
  const visibleFormatIds = useMemo(
    () => new Set(activeChannelFormats ?? []),
    [activeChannelFormats]
  );

  const formats = useMemo(
    () => allFormats?.filter((f) => visibleFormatIds.has(f.id)) ?? [],
    [allFormats, visibleFormatIds]
  );

  // Group formats by container type for column headers
  const formatGroups = useMemo(() => {
    const groups: FormatGroup[] = [];
    let currentContainerId = "";
    for (const f of formats) {
      if (f.container_id !== currentContainerId) {
        groups.push({ containerName: f.container_name, containerType: f.container_type, formats: [] });
        currentContainerId = f.container_id;
      }
      groups[groups.length - 1].formats.push(f);
    }
    return groups;
  }, [formats]);

  // Pre-compute which format IDs start a new container group (for border rendering)
  const groupBorderSet = useMemo(() => {
    const set = new Set<string>();
    for (let i = 1; i < formatGroups.length; i++) {
      const firstFmt = formatGroups[i].formats[0];
      if (firstFmt) set.add(firstFmt.id);
    }
    return set;
  }, [formatGroups]);

  const { data: prices } = useQuery({
    queryKey: settingsKeys.pricingMatrix(activeChannelId ?? undefined),
    queryFn: async () => {
      if (!activeChannelId) return [];
      const { data, error } = await supabase
        .from("pricing_tier_prices")
        .select("id, pricing_tier_id, format_id, sales_channel_id, price")
        .eq("sales_channel_id", activeChannelId);
      if (error) throw error;
      return data as PricingTierPrice[];
    },
    enabled: !!activeChannelId,
  });

  // Build price lookup: tier_id -> format_id -> price
  const priceMap = useMemo(() => {
    const map = new Map<string, Map<string, PricingTierPrice>>();
    prices?.forEach((p) => {
      if (!map.has(p.pricing_tier_id)) {
        map.set(p.pricing_tier_id, new Map());
      }
      map.get(p.pricing_tier_id)!.set(p.format_id, p);
    });
    return map;
  }, [prices]);

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const saveMutation = useMutation({
    mutationFn: async ({
      tierId,
      formatId,
      channelId,
      value,
    }: {
      tierId: string;
      formatId: string;
      channelId: string;
      value: number | null;
    }) => {
      const existing = priceMap.get(tierId)?.get(formatId);

      if (value === null && existing) {
        const { error } = await supabase
          .from("pricing_tier_prices")
          .delete()
          .eq("id", existing.id);
        if (error) throw error;
      } else if (value !== null && existing) {
        const { error } = await supabase
          .from("pricing_tier_prices")
          .update({ price: value, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (error) throw error;
      } else if (value !== null && !existing) {
        const { error } = await supabase.from("pricing_tier_prices").insert({
          pricing_tier_id: tierId,
          format_id: formatId,
          sales_channel_id: channelId,
          price: value,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: settingsKeys.pricingMatrix(activeChannelId ?? undefined),
      });
    },
    onError: (error) => {
      log.error("Failed to save price:", error);
      toast.error("Failed to save price");
    },
  });

  const handleSave = useCallback(
    (tierId: string, formatId: string, channelId: string, value: number | null) => {
      saveMutation.mutate({ tierId, formatId, channelId, value });
    },
    [saveMutation]
  );

  // ---------------------------------------------------------------------------
  // Navigation helpers for Tab/Enter/Arrow in cells
  // ---------------------------------------------------------------------------

  const tableRef = useRef<HTMLDivElement>(null);

  const handleCellNavigate = useCallback(
    (rowIndex: number, colIndex: number, direction: NavigateDirection) => {
      if (!tiers || !formats.length) return;

      let newRow = rowIndex;
      let newCol = colIndex;

      switch (direction) {
        case "up":
          newRow = Math.max(0, rowIndex - 1);
          break;
        case "down":
          newRow = Math.min(tiers.length - 1, rowIndex + 1);
          break;
        case "left":
          newCol = Math.max(0, colIndex - 1);
          break;
        case "right":
          newCol = Math.min(formats.length - 1, colIndex + 1);
          break;
      }

      const targetButton = tableRef.current?.querySelector(
        `button[data-cell-row="${newRow}"][data-cell-col="${newCol}"]`
      ) as HTMLButtonElement | null;
      targetButton?.click();
    },
    [tiers, formats]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      {/* Channel Tabs */}
      <Tabs
        value={activeChannelId ?? undefined}
        onValueChange={onChannelChange}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            {channels.map((ch) => (
              <TabsTrigger key={ch.id} value={ch.id}>
                {ch.name}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Toolbar */}
          <div className="flex items-center gap-2">
            <BulkAdjustPopover
              channelId={activeChannelId}
              channelName={activeChannelName}
            />
            <CopyChannelPopover
              channels={channels}
              activeChannelId={activeChannelId}
              activeChannelName={activeChannelName}
            />
          </div>
        </div>
      </Tabs>

      {/* Matrix Grid */}
      {!tiers?.length && (
        <p className="text-muted-foreground py-8 text-center">
          No pricing tiers defined. Switch to Tier Settings to create tiers.
        </p>
      )}

      {!!tiers?.length && !formats.length && (
        <p className="text-muted-foreground py-8 text-center">
          No formats enabled for this channel. Switch to the{" "}
          <button onClick={onShowFormats} className="underline">
            Formats
          </button>{" "}
          tab to select which formats appear in the matrix.
        </p>
      )}

      {!!tiers?.length && !!formats.length && (
        isMobile ? (
          <PricingMobileCards
            tiers={tiers}
            formatGroups={formatGroups}
            priceMap={priceMap}
            activeChannelId={activeChannelId!}
            onSave={handleSave}
          />
        ) : (
        <div ref={tableRef} className="overflow-x-auto border rounded-lg">
          <Table className="table-fixed">
            <TableHeader className="sticky top-0 z-20">
              {/* Container group header row */}
              {formatGroups.length > 1 && (
                <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-0">
                  <TableHead className="sticky left-0 z-10 bg-muted/50" />
                  {formatGroups.map((group, gi) => (
                    <TableHead
                      key={group.containerName}
                      colSpan={group.formats.length}
                      className={cn(
                        "text-center text-xs font-medium text-muted-foreground border-b-0",
                        gi > 0 && "border-l"
                      )}
                    >
                      {group.containerName}
                    </TableHead>
                  ))}
                </TableRow>
              )}
              {/* Format sub-header row */}
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="sticky left-0 z-10 bg-muted/50 min-w-[120px]">
                  Tier
                </TableHead>
                {formatGroups.map((group, gi) =>
                  group.formats.map((f, fi) => (
                    <TableHead
                      key={f.id}
                      className={cn(
                        "text-right w-[120px]",
                        gi > 0 && fi === 0 && "border-l"
                      )}
                    >
                      <div className="leading-tight">
                        <div className="text-xs font-medium">{f.name}</div>
                      </div>
                    </TableHead>
                  ))
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tiers.map((tier, tierIdx) => (
                <TableRow
                  key={tier.id}
                  className={
                    tierIdx % 2 === 0
                      ? "bg-background hover:bg-muted/50"
                      : "bg-muted/25 hover:bg-muted/50"
                  }
                >
                  <TableCell className="sticky left-0 z-10 bg-inherit border-r px-3 py-1">
                    <div>
                      <div className="font-medium">{tier.name}</div>
                      {tier.cogs_max != null && (
                        <div className="text-[10px] text-muted-foreground">
                          &le; ${Number(tier.cogs_max).toFixed(2)}/unit
                        </div>
                      )}
                    </div>
                  </TableCell>
                  {formats.map((fmt, fmtIdx) => {
                    const priceObj = priceMap.get(tier.id)?.get(fmt.id);
                    const isFirstInGroup = groupBorderSet.has(fmt.id);
                    return (
                      <TableCell key={fmt.id} className={cn("px-1 py-0.5", isFirstInGroup && "border-l")}>
                        <PriceCell
                          price={priceObj?.price ?? null}
                          tierId={tier.id}
                          formatId={fmt.id}
                          channelId={activeChannelId!}
                          rowIndex={tierIdx}
                          colIndex={fmtIdx}
                          label={`${tier.name} — ${fmt.name}`}
                          onSave={handleSave}
                          onNavigate={handleCellNavigate}
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        )
      )}

      {/* Legend */}
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <DollarSign className="h-3 w-3" />
        Click to edit. Arrow keys, Tab, or Enter to navigate.
      </p>
    </>
  );
}
