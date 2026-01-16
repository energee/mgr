"use client";

/**
 * Price Tiers List Page
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Layers } from "lucide-react";
import { EntityList } from "@/components/universal/entity-list";
import { priceTierEntity } from "@/entities/price-tier";

export default function PriceTiersPage() {
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
            <Layers className="h-6 w-6" />
            Price Tiers
          </h1>
          <p className="text-muted-foreground">
            Manage pricing tiers for each sales channel
          </p>
        </div>
      </div>

      {/* Entity List */}
      <EntityList
        entity={priceTierEntity}
        basePath="/settings/pricing/tiers"
      />
    </div>
  );
}
