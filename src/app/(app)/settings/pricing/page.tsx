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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  DollarSign,
  Percent,
  Copy,
  Settings2,
  Grid3X3,
  Package,
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
  format_source: "package_type" | "keg_type";
  container_type: string | null;
  volume_oz: number | null;
  units_per_case: number | null;
}

interface PricingTierPrice {
  id: string;
  pricing_tier_id: string;
  format_id: string;
  sales_channel_id: string;
  price: number;
}

// =============================================================================
// Helpers
// =============================================================================

function formatColumnLabel(f: PackageFormat): { name: string; unit: string } {
  if (f.format_source === "keg_type") {
    return { name: f.name, unit: "per keg" };
  }
  if (f.units_per_case) {
    return { name: f.name, unit: `case/${f.units_per_case}` };
  }
  return { name: f.name, unit: "each" };
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
  const dirtyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const startEditing = useCallback(() => {
    setValue(price != null ? price.toFixed(2) : "");
    dirtyRef.current = false;
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
    // If the user never typed anything, treat as cancel — prevents accidental
    // deletes when a cell is opened before price data has loaded.
    if (!dirtyRef.current) return;
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
        onChange={(e) => { dirtyRef.current = true; setValue(e.target.value); }}
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
      className={cn(
        "w-full h-8 text-right text-sm px-2 rounded transition-colors cursor-text tabular-nums",
        price != null
          ? "hover:bg-muted/50"
          : "text-muted-foreground/30 hover:bg-muted/30"
      )}
    >
      {price != null ? `$${price.toFixed(2)}` : "·"}
    </button>
  );
}

// =============================================================================
// Format Management Component
// =============================================================================

function FormatManagement({
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

  // All active formats (master list gated by show_in_pricing)
  const { data: formats, isLoading: formatsLoading } = useQuery({
    queryKey: settingsKeys.pricingFormatsAll(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("packaging_formats")
        .select("id, name, format_source, container_type, volume_oz, units_per_case, show_in_pricing")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as (PackageFormat & { show_in_pricing: boolean })[];
    },
  });

  // Per-channel enabled formats
  const { data: channelFormats, isLoading: channelFormatsLoading } = useQuery({
    queryKey: settingsKeys.pricingChannelFormats(activeChannelId ?? ""),
    queryFn: async () => {
      if (!activeChannelId) return [];
      // Table not yet in generated types — cast until types are regenerated
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("pricing_channel_formats")
        .select("format_id")
        .eq("sales_channel_id", activeChannelId);
      if (error) throw error;
      return (data as { format_id: string }[]).map((r) => r.format_id);
    },
    enabled: !!activeChannelId,
  });

  const enabledSet = new Set(channelFormats ?? []);

  // Toggle per-channel visibility (insert/delete from junction table)
  const toggleChannelFormatMutation = useMutation({
    mutationFn: async ({ formatId, enabled }: { formatId: string; enabled: boolean }) => {
      if (!activeChannelId) return;
      // Table not yet in generated types — cast until types are regenerated
      if (enabled) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any)
          .from("pricing_channel_formats")
          .insert({ sales_channel_id: activeChannelId, format_id: formatId });
        if (error) throw error;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any)
          .from("pricing_channel_formats")
          .delete()
          .eq("sales_channel_id", activeChannelId)
          .eq("format_id", formatId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: settingsKeys.pricingChannelFormats(activeChannelId ?? ""),
      });
      // Also refresh matrix formats when toggling
      queryClient.invalidateQueries({ queryKey: settingsKeys.pricingFormats() });
    },
  });

  const isLoading = formatsLoading || channelFormatsLoading;
  if (isLoading) return <Skeleton className="h-64 w-full" />;

  // Only show formats where show_in_pricing = true
  const priceable = formats?.filter(f => f.show_in_pricing) ?? [];
  const packaged = priceable.filter(f => f.format_source === "package_type");
  const kegs = priceable.filter(f => f.format_source === "keg_type");

  const renderSection = (title: string, items: typeof packaged) => (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          No {title.toLowerCase()} have &quot;Show in Pricing&quot; enabled.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Format</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="w-[100px] text-right">Enabled</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(f => (
              <TableRow key={f.id}>
                <TableCell className="font-medium">{f.name}</TableCell>
                <TableCell className="text-muted-foreground capitalize">{f.container_type}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatColumnLabel(f).unit}
                </TableCell>
                <TableCell className="text-right">
                  <Switch
                    checked={enabledSet.has(f.id)}
                    onCheckedChange={(checked) =>
                      toggleChannelFormatMutation.mutate({
                        formatId: f.id,
                        enabled: checked,
                      })
                    }
                    disabled={toggleChannelFormatMutation.isPending}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );

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
        Toggle which formats appear in the pricing matrix for{" "}
        <span className="font-medium text-foreground">
          {channels.find(c => c.id === activeChannelId)?.name ?? "this channel"}
        </span>.
        Only formats with &quot;Show in Pricing&quot; enabled in their catalog settings appear here.
      </p>

      {renderSection("Packaged Formats", packaged)}
      {renderSection("Keg Formats", kegs)}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export default function PricingPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const [channelOverride, setChannelOverride] = useState<string | null>(null);
  const [view, setView] = useState<"matrix" | "tiers" | "formats">("matrix");
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
      const { data, error } = await supabase
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
      const { data, error } = await supabase
        .from("pricing_tiers")
        .select("id, name, cogs_max")
        .order("cogs_max", { nullsFirst: false });
      if (error) throw error;
      return data as PricingTier[];
    },
  });

  // Fetch channel-specific format IDs from junction table
  const { data: channelFormatIds, isLoading: channelFormatsLoading } = useQuery({
    queryKey: settingsKeys.pricingChannelFormats(activeChannelId ?? ""),
    queryFn: async () => {
      if (!activeChannelId) return [];
      // Table not yet in generated types — cast until types are regenerated
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("pricing_channel_formats")
        .select("format_id")
        .eq("sales_channel_id", activeChannelId);
      if (error) throw error;
      return (data as { format_id: string }[]).map((r) => r.format_id);
    },
    enabled: !!activeChannelId,
  });

  const { data: allPricingFormats, isLoading: formatsLoading } = useQuery({
    queryKey: settingsKeys.pricingFormats(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("packaging_formats")
        .select("id, name, format_source, container_type, volume_oz, units_per_case")
        .eq("is_active", true)
        .eq("show_in_pricing", true)
        .order("name");
      if (error) throw error;
      return data as PackageFormat[];
    },
  });

  // Filter formats to only those enabled for the active channel
  const channelFormatSet = new Set(channelFormatIds ?? []);
  const formats = allPricingFormats?.filter(f => channelFormatSet.has(f.id)) ?? undefined;

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
  const priceMap = new Map<string, Map<string, PricingTierPrice>>();
  prices?.forEach((p) => {
    if (!priceMap.has(p.pricing_tier_id)) {
      priceMap.set(p.pricing_tier_id, new Map());
    }
    priceMap.get(p.pricing_tier_id)!.set(p.format_id, p);
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
        const { error } = await supabase
          .from("pricing_tier_prices")
          .delete()
          .eq("id", existing.id);
        if (error) throw error;
      } else if (value !== null && existing) {
        // Update
        const { error } = await supabase
          .from("pricing_tier_prices")
          .update({ price: value, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (error) throw error;
      } else if (value !== null && !existing) {
        // Insert
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
      const { data: channelPrices, error: fetchError } = await supabase
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
        const { error } = await supabase
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
      const { data: sourcePrices, error: fetchError } = await supabase
        .from("pricing_tier_prices")
        .select("pricing_tier_id, format_id, price")
        .eq("sales_channel_id", fromChannelId);
      if (fetchError) throw fetchError;

      if (!sourcePrices?.length) {
        toast.error("Source channel has no prices");
        return;
      }

      // Upsert each price into the target channel
      for (const sp of sourcePrices) {
        const { error } = await supabase.from("pricing_tier_prices").upsert(
          {
            pricing_tier_id: sp.pricing_tier_id,
            format_id: sp.format_id,
            sales_channel_id: toChannelId,
            price: sp.price,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "pricing_tier_id,format_id,sales_channel_id" }
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

  const isLoading = channelsLoading || tiersLoading || formatsLoading || channelFormatsLoading;

  // Derived format groups: packaged first, then kegs
  const packagedFormats = formats?.filter(f => f.format_source === "package_type") ?? [];
  const kegFormats = formats?.filter(f => f.format_source === "keg_type") ?? [];
  const allFormats = [...packagedFormats, ...kegFormats];

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
          <Button
            variant={view === "formats" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("formats")}
          >
            <Package className="h-4 w-4 mr-1" />
            Formats
          </Button>
        </div>
      </div>

      {view === "tiers" ? (
        <EntityList
          entity={pricingTierEntity}
          basePath="/settings/pricing/tiers"
        />
      ) : view === "formats" ? (
        <FormatManagement
          channels={channels ?? []}
          activeChannelId={activeChannelId}
          onChannelChange={setChannelOverride}
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
              No formats enabled for pricing. Switch to the{" "}
              <button onClick={() => setView("formats")} className="underline">
                Formats
              </button>{" "}
              tab to select which formats appear in the matrix.
            </p>
          )}

          {!!tiers?.length && !!formats?.length && (
            <div ref={tableRef} className="border rounded-lg">
              <Table className="table-fixed">
                <TableHeader className="sticky top-0 z-20">
                  {(packagedFormats.length > 0 && kegFormats.length > 0) && (
                    <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-0">
                      <TableHead className="sticky left-0 z-10 bg-muted/50" />
                      <TableHead
                        colSpan={packagedFormats.length}
                        className="text-center text-xs font-medium text-muted-foreground border-b-0"
                      >
                        Packaged
                      </TableHead>
                      <TableHead
                        colSpan={kegFormats.length}
                        className="text-center text-xs font-medium text-muted-foreground border-l border-b-0"
                      >
                        Draft / Kegs
                      </TableHead>
                    </TableRow>
                  )}
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="sticky left-0 z-10 bg-muted/50 min-w-[120px]">
                      Tier
                    </TableHead>
                    {allFormats.map((f) => {
                      const label = formatColumnLabel(f);
                      const isFirstKeg = kegFormats.length > 0 && f.id === kegFormats[0].id;
                      return (
                        <TableHead
                          key={f.id}
                          className={cn("text-right w-[120px]", isFirstKeg && "border-l")}
                        >
                          <div className="leading-tight">
                            <div className="text-xs font-medium">{label.name}</div>
                            <div className="text-[10px] text-muted-foreground font-normal">{label.unit}</div>
                          </div>
                        </TableHead>
                      );
                    })}
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
                      {allFormats.map((fmt, fmtIdx) => {
                        const priceObj = priceMap.get(tier.id)?.get(fmt.id);
                        const isFirstKeg = kegFormats.length > 0 && fmt.id === kegFormats[0].id;
                        return (
                          <TableCell key={fmt.id} className={cn("px-1 py-0.5", isFirstKeg && "border-l")}>
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
