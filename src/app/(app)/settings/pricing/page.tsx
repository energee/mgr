"use client";

/**
 * Pricing Settings Page
 *
 * Hub for managing price tiers and tier prices.
 * Links to sub-pages for detailed management.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { settingsKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, DollarSign, Layers, Plus } from "lucide-react";

export default function PricingPage() {
  const supabase = createClient();

  // Fetch summary stats
  // Cast to any for tables not yet in generated types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: stats, isLoading } = useQuery({
    queryKey: settingsKeys.pricingStats(),
    queryFn: async () => {
      const [tiersResult, pricesResult] = await Promise.all([
        db.from("price_tiers").select("id, name, sales_channel_id, is_default", { count: "exact" }),
        db.from("tier_prices").select("id", { count: "exact" }),
      ]);

      return {
        tierCount: tiersResult.count || 0,
        priceCount: pricesResult.count || 0,
      };
    },
  });

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <DollarSign className="h-6 w-6" />
            Pricing
          </h1>
          <p className="text-muted-foreground">
            Manage price tiers and format pricing
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <Link href="/settings/pricing/tiers">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="h-5 w-5" />
                Price Tiers
              </CardTitle>
              <CardDescription>
                Pricing levels within each sales channel
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-2xl font-bold">{stats?.tierCount}</p>
              )}
              <p className="text-sm text-muted-foreground">active tiers</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/settings/pricing/prices">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <DollarSign className="h-5 w-5" />
                Tier Prices
              </CardTitle>
              <CardDescription>
                Specific prices per format, brand, and style
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-2xl font-bold">{stats?.priceCount}</p>
              )}
              <p className="text-sm text-muted-foreground">prices configured</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Link href="/settings/pricing/tiers/new">
            <Button variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              New Price Tier
            </Button>
          </Link>
          <Link href="/settings/pricing/prices/new">
            <Button variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              New Tier Price
            </Button>
          </Link>
        </CardContent>
      </Card>

      {/* Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How Pricing Works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            <strong>1. Sales Channels</strong> categorize your customers (Distributor, Retailer, Taproom).
          </p>
          <p>
            <strong>2. Price Tiers</strong> define pricing levels within each channel (Standard, Premium).
          </p>
          <p>
            <strong>3. Tier Prices</strong> set specific prices for each package format, optionally
            by brand or style.
          </p>
          <p>
            <strong>4. Customers</strong> are assigned to a sales channel, and optionally a specific
            tier. Orders use their tier pricing automatically.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
