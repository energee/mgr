"use client";

/**
 * Sales Channels Settings Page
 *
 * Manage sales channel categories (distributor, retailer, taproom, export).
 * Uses the universal EntityList component with the salesChannelEntity config.
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Store } from "lucide-react";
import { EntityList } from "@/components/universal/entity-list";
import { salesChannelEntity } from "@/entities/sales-channel";

export default function SalesChannelsPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Store className="h-6 w-6" />
            Sales Channels
          </h1>
          <p className="text-muted-foreground">
            Manage sales channels for customer pricing
          </p>
        </div>
      </div>

      {/* Entity List */}
      <EntityList
        entity={salesChannelEntity}
        basePath="/settings/sales-channels"
      />
    </div>
  );
}
