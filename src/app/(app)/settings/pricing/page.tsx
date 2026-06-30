"use client";

/**
 * Pricing Page
 *
 * Settings page for tier-based pricing with four views:
 * - Matrix: spreadsheet-like pricing grid (PricingMatrixView)
 * - Tier Settings: pricing tier CRUD (EntityList)
 * - Formats: per-channel format visibility toggles (FormatManagement)
 * - Channels: sales channel CRUD (EntityList)
 *
 * This file owns the shared queries (channels, tiers, formats) and the
 * view/channel selection state; the views themselves live in
 * `src/components/domain/pricing/`.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { settingsKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { Settings2, Grid3X3, Package, Store } from "lucide-react";
import { EntityList } from "@/components/universal/entity-list";
import { pricingTierEntity } from "@/entities/pricing-tier";
import { salesChannelEntity } from "@/entities/sales-channel";
import { FormatManagement } from "@/components/domain/pricing/format-management";
import { PricingMatrixView } from "@/components/domain/pricing/pricing-matrix-view";
import type {
  PricingTier,
  SalesChannel,
  SellingFormatWithContainer,
} from "@/components/domain/pricing/types";

export default function PricingPage() {
  const supabase = createClient();

  const [channelOverride, setChannelOverride] = useState<string | null>(null);
  const [view, setView] = useState<"matrix" | "tiers" | "formats" | "channels">("matrix");

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

  // Fetch all active selling formats with container info
  const { data: allFormats, isLoading: formatsLoading } = useQuery({
    queryKey: settingsKeys.pricingFormats(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("packaging_formats")
        .select("id, name, container_name, container_type, container_id, unit_count, volume_oz, volume_bbl")
        .eq("is_active", true)
        .order("container_type")
        .order("container_id")
        .order("position")
        .order("name");
      if (error) throw error;
      return data as SellingFormatWithContainer[];
    },
  });

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pricing</h1>
          <p className="text-muted-foreground">Manage tier-based pricing matrix</p>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto">
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
          <Button
            variant={view === "channels" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("channels")}
          >
            <Store className="h-4 w-4 mr-1" />
            Channels
          </Button>
        </div>
      </div>

      {view === "channels" && (
        <EntityList
          key="channels"
          entity={salesChannelEntity}
          basePath="/settings/sales-channels"
        />
      )}

      {view === "tiers" && (
        <EntityList
          key="tiers"
          entity={pricingTierEntity}
          basePath="/settings/pricing/tiers"
        />
      )}

      {view === "formats" && (
        <FormatManagement
          channels={channels}
          activeChannelId={activeChannelId}
          onChannelChange={setChannelOverride}
        />
      )}

      {view === "matrix" && (
        <PricingMatrixView
          channels={channels}
          tiers={tiers}
          allFormats={allFormats}
          activeChannelId={activeChannelId}
          onChannelChange={setChannelOverride}
          onShowFormats={() => setView("formats")}
        />
      )}
    </div>
  );
}
