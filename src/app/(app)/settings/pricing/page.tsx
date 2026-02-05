"use client";

/**
 * Pricing Matrix Page
 *
 * Spreadsheet-like grid for managing tier-based pricing.
 * - Tabs: sales channels across the top
 * - Rows: pricing tiers (sorted by sort_order)
 * - Columns: priceable package formats (show_in_pricing = true)
 *
 * Supports inline editing, bulk adjustments, and copy-channel.
 * Tier settings toggled via a secondary view.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { settingsKeys } from "@/lib/query-keys";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import {
  DollarSign,
  Percent,
  Copy,
  Settings2,
  Grid3X3,
} from "lucide-react";
import { EntityList } from "@/components/universal/entity-list";
import { pricingTierEntity } from "@/entities/pricing-tier";

// =============================================================================
// Types
// =============================================================================

interface SalesChannel {
  id: string;
  name: string;
  code: string;
  position: number;
  is_active: boolean;
}

interface PricingTier {
  id: string;
  name: string;
  cogs_max: number | null;
}

interface PackageFormat {
  id: string;
  name: string;
}

interface PricingTierPrice {
  id: string;
  pricing_tier_id: string;
  package_format_id: string;
  sales_channel_id: string;
  price: number;
}

// =============================================================================
// Cell Editor Component
// =============================================================================

type NavigateDirection = "up" | "down" | "left" | "right";

function PriceCell({
  price,
  tierId,
  formatId,
  channelId,
  rowIndex,
  colIndex,
  onSave,
  onNavigate,
}: {
  price: number | null;
  tierId: string;
  formatId: string;
  channelId: string;
  rowIndex: number;
  colIndex: number;
  onSave: (tierId: string, formatId: string, channelId: string, value: number | null) => void;
  onNavigate: (rowIndex: number, colIndex: number, direction: NavigateDirection) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const startEditing = useCallback(() => {
    setValue(price != null ? price.toFixed(2) : "");
    setEditing(true);
  }, [price]);

  // Expose focus method via data attribute for external navigation
  useEffect(() => {
    const el = buttonRef.current;
    if (el) {
      el.dataset.cellRow = String(rowIndex);
      el.dataset.cellCol = String(colIndex);
    }
  }, [rowIndex, colIndex]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    const trimmed = value.trim();
    const parsed = trimmed === "" ? null : parseFloat(trimmed);
    if (trimmed !== "" && (isNaN(parsed!) || parsed! < 0)) {
      toast.error("Invalid price");
      return;
    }
    if (parsed !== price) {
      onSave(tierId, formatId, channelId, parsed);
    }
  }, [value, price, tierId, formatId, channelId, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
        onNavigate(rowIndex, colIndex, "down");
      } else if (e.key === "Tab") {
        e.preventDefault();
        commit();
        onNavigate(rowIndex, colIndex, e.shiftKey ? "left" : "right");
      } else if (e.key === "Escape") {
        setEditing(false);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        commit();
        onNavigate(rowIndex, colIndex, "up");
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        commit();
        onNavigate(rowIndex, colIndex, "down");
      } else if (e.key === "ArrowLeft" && inputRef.current?.selectionStart === 0) {
        e.preventDefault();
        commit();
        onNavigate(rowIndex, colIndex, "left");
      } else if (e.key === "ArrowRight" && inputRef.current?.selectionStart === value.length) {
        e.preventDefault();
        commit();
        onNavigate(rowIndex, colIndex, "right");
      }
    },
    [commit, onNavigate, rowIndex, colIndex, value.length]
  );

  if (editing) {
    return (
      <Input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        className="h-8 w-full text-right text-sm px-2 py-0 tabular-nums"
      />
    );
  }

  return (
    <button
      ref={buttonRef}
      onClick={startEditing}
      className="w-full h-8 text-right text-sm px-2 rounded hover:bg-muted/50 transition-colors cursor-text tabular-nums"
    >
      {price != null ? `$${price.toFixed(2)}` : "—"}
    </button>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export default function PricingPage() {
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const queryClient = useQueryClient();

  const [channelOverride, setChannelOverride] = useState<string | null>(null);
  const [view, setView] = useState<"matrix" | "tiers">("matrix");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkType, setBulkType] = useState<"percent" | "flat">("percent");
  const [bulkValue, setBulkValue] = useState("");
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyFromChannel, setCopyFromChannel] = useState<string>("");

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  const { data: channels, isLoading: channelsLoading } = useQuery({
    queryKey: settingsKeys.pricingChannels(),
    queryFn: async () => {
      const { data, error } = await db
        .from("sales_channels")
        .select("id, name, code, position, is_active")
        .eq("is_active", true)
        .order("position");
      if (error) throw error;
      return data as SalesChannel[];
    },
  });

  // Derive active channel: user override or first available
  const activeChannelId = channelOverride ?? channels?.[0]?.id ?? null;

  const { data: tiers, isLoading: tiersLoading } = useQuery({
    queryKey: settingsKeys.pricingTiers(),
    queryFn: async () => {
      const { data, error } = await db
        .from("pricing_tiers")
        .select("id, name, cogs_max")
        .order("cogs_max", { nullsFirst: false });
      if (error) throw error;
      return data as PricingTier[];
    },
  });

  const { data: formats, isLoading: formatsLoading } = useQuery({
    queryKey: settingsKeys.pricingFormats(),
    queryFn: async () => {
      const { data, error } = await db
        .from("package_types")
        .select("id, name")
        .eq("is_active", true)
        .eq("show_in_pricing", true)
        .order("name");
      if (error) throw error;
      return data as PackageFormat[];
    },
  });

  const { data: prices } = useQuery({
    queryKey: settingsKeys.pricingMatrix(activeChannelId ?? undefined),
    queryFn: async () => {
      if (!activeChannelId) return [];
      const { data, error } = await db
        .from("pricing_tier_prices")
        .select("id, pricing_tier_id, package_format_id, sales_channel_id, price")
        .eq("sales_channel_id", activeChannelId);
      if (error) throw error;
      return data as PricingTierPrice[];
    },
    enabled: !!activeChannelId,
  });

  // Build price lookup: tier_id -> format_id -> price
  const priceMap = new Map<string, Map<string, PricingTierPrice>>();
  prices?.forEach((p) => {
    if (!priceMap.has(p.pricing_tier_id)) {
      priceMap.set(p.pricing_tier_id, new Map());
    }
    priceMap.get(p.pricing_tier_id)!.set(p.package_format_id, p);
  });

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
        // Delete
        const { error } = await db
          .from("pricing_tier_prices")
          .delete()
          .eq("id", existing.id);
        if (error) throw error;
      } else if (value !== null && existing) {
        // Update
        const { error } = await db
          .from("pricing_tier_prices")
          .update({ price: value, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (error) throw error;
      } else if (value !== null && !existing) {
        // Insert
        const { error } = await db.from("pricing_tier_prices").insert({
          pricing_tier_id: tierId,
          package_format_id: formatId,
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
      console.error("Failed to save price:", error);
      toast.error("Failed to save price");
    },
  });

  const handleSave = useCallback(
    (tierId: string, formatId: string, channelId: string, value: number | null) => {
      saveMutation.mutate({ tierId, formatId, channelId, value });
    },
    [saveMutation]
  );

  // Bulk adjust
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
      // Fetch all prices for this channel
      const { data: channelPrices, error: fetchError } = await db
        .from("pricing_tier_prices")
        .select("id, price")
        .eq("sales_channel_id", channelId);
      if (fetchError) throw fetchError;

      // Apply adjustment to each
      for (const p of channelPrices || []) {
        const newPrice =
          type === "percent"
            ? Math.round(p.price * (1 + amount / 100) * 100) / 100
            : Math.round((p.price + amount) * 100) / 100;
        if (newPrice < 0) continue;
        const { error } = await db
          .from("pricing_tier_prices")
          .update({ price: newPrice, updated_at: new Date().toISOString() })
          .eq("id", p.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: settingsKeys.pricingMatrix(activeChannelId ?? undefined),
      });
      toast.success("Prices adjusted");
      setBulkOpen(false);
      setBulkValue("");
    },
    onError: (error) => {
      console.error("Bulk adjust failed:", error);
      toast.error("Failed to adjust prices");
    },
  });

  // Copy channel
  const copyChannelMutation = useMutation({
    mutationFn: async ({
      fromChannelId,
      toChannelId,
    }: {
      fromChannelId: string;
      toChannelId: string;
    }) => {
      // Fetch source prices
      const { data: sourcePrices, error: fetchError } = await db
        .from("pricing_tier_prices")
        .select("pricing_tier_id, package_format_id, price")
        .eq("sales_channel_id", fromChannelId);
      if (fetchError) throw fetchError;

      if (!sourcePrices?.length) {
        toast.error("Source channel has no prices");
        return;
      }

      // Upsert each price into the target channel
      for (const sp of sourcePrices) {
        const { error } = await db.from("pricing_tier_prices").upsert(
          {
            pricing_tier_id: sp.pricing_tier_id,
            package_format_id: sp.package_format_id,
            sales_channel_id: toChannelId,
            price: sp.price,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "pricing_tier_id,package_format_id,sales_channel_id" }
        );
        if (error) throw error;
      }
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
      console.error("Copy channel failed:", error);
      toast.error("Failed to copy prices");
    },
  });

  // ---------------------------------------------------------------------------
  // Navigation helpers for Tab/Enter/Arrow in cells
  // ---------------------------------------------------------------------------

  const tableRef = useRef<HTMLDivElement>(null);

  const handleCellNavigate = useCallback(
    (rowIndex: number, colIndex: number, direction: NavigateDirection) => {
      if (!tiers || !formats) return;

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

      // Find and click the target cell button
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

  const isLoading = channelsLoading || tiersLoading || formatsLoading;

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-6xl">
        <div>
          <h1 className="text-2xl font-bold">Pricing</h1>
          <p className="text-muted-foreground">Manage tier-based pricing matrix</p>
        </div>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!channels?.length) {
    return (
      <div className="space-y-6 max-w-6xl">
        <div>
          <h1 className="text-2xl font-bold">Pricing</h1>
          <p className="text-muted-foreground">Manage tier-based pricing matrix</p>
        </div>
        <p className="text-muted-foreground">
          No active sales channels found. Create sales channels in{" "}
          <Link href="/settings/sales-channels" className="underline">
            Settings &gt; Sales Channels
          </Link>{" "}
          first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pricing</h1>
          <p className="text-muted-foreground">Manage tier-based pricing matrix</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={view === "matrix" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("matrix")}
          >
            <Grid3X3 className="h-4 w-4 mr-1" />
            Matrix
          </Button>
          <Button
            variant={view === "tiers" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("tiers")}
          >
            <Settings2 className="h-4 w-4 mr-1" />
            Tier Settings
          </Button>
        </div>
      </div>

      {view === "tiers" ? (
        <EntityList
          entity={pricingTierEntity}
          basePath="/settings/pricing/tiers"
        />
      ) : (
        <>
          {/* Channel Tabs */}
          <Tabs
            value={activeChannelId ?? undefined}
            onValueChange={setChannelOverride}
          >
            <div className="flex items-center justify-between">
              <TabsList>
                {channels.map((ch) => (
                  <TabsTrigger key={ch.id} value={ch.id}>
                    {ch.name}
                  </TabsTrigger>
                ))}
              </TabsList>

              {/* Toolbar */}
              <div className="flex items-center gap-2">
                {/* Bulk Adjust */}
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
                        Adjust all prices in{" "}
                        {channels.find((c) => c.id === activeChannelId)?.name}
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
                          if (isNaN(amount) || !activeChannelId) return;
                          bulkAdjustMutation.mutate({
                            type: bulkType,
                            amount,
                            channelId: activeChannelId,
                          });
                        }}
                      >
                        {bulkAdjustMutation.isPending ? "Applying..." : "Apply"}
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>

                {/* Copy Channel */}
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
                        Copy prices into{" "}
                        {channels.find((c) => c.id === activeChannelId)?.name}
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
                        disabled={
                          !copyFromChannel || copyChannelMutation.isPending
                        }
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
              </div>
            </div>
          </Tabs>

          {/* Matrix Grid */}
          {!tiers?.length && (
            <p className="text-muted-foreground py-8 text-center">
              No pricing tiers defined. Switch to Tier Settings to create tiers.
            </p>
          )}

          {!!tiers?.length && !formats?.length && (
            <p className="text-muted-foreground py-8 text-center">
              No package formats marked for pricing. Enable{" "}
              <code className="text-xs">show_in_pricing</code> on package formats in{" "}
              <Link href="/settings/formats" className="underline">
                Settings &gt; Package Formats
              </Link>
              .
            </p>
          )}

          {!!tiers?.length && !!formats?.length && (
            <div ref={tableRef} className="border rounded-lg">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="sticky left-0 z-10 bg-muted/50 min-w-[120px]">
                      Tier
                    </TableHead>
                    {formats.map((f) => (
                      <TableHead
                        key={f.id}
                        className="text-right w-[120px]"
                      >
                        {f.name}
                      </TableHead>
                    ))}
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
                      <TableCell className="sticky left-0 z-10 bg-inherit border-r px-3 py-1 font-medium">
                        {tier.name}
                      </TableCell>
                      {formats.map((fmt, fmtIdx) => {
                        const priceObj = priceMap.get(tier.id)?.get(fmt.id);
                        return (
                          <TableCell key={fmt.id} className="px-1 py-0.5">
                            <PriceCell
                              price={priceObj?.price ?? null}
                              tierId={tier.id}
                              formatId={fmt.id}
                              channelId={activeChannelId!}
                              rowIndex={tierIdx}
                              colIndex={fmtIdx}
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
          )}

          {/* Legend */}
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <DollarSign className="h-3 w-3" />
            Click to edit. Arrow keys, Tab, or Enter to navigate.
          </p>
        </>
      )}
    </div>
  );
}
