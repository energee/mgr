"use client";

/**
 * Tier Prices List Page
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, DollarSign } from "lucide-react";
import { EntityList } from "@/components/universal/entity-list";
import { tierPriceEntity } from "@/entities/tier-price";

export default function TierPricesPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/settings/pricing">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <DollarSign className="h-6 w-6" />
            Tier Prices
          </h1>
          <p className="text-muted-foreground">
            Manage prices for each format, brand, and style combination
          </p>
        </div>
      </div>

      {/* Entity List */}
      <EntityList
        entity={tierPriceEntity}
        basePath="/settings/pricing/prices"
      />
    </div>
  );
}
