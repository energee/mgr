"use client";

/**
 * Sales Channels Settings Page
 *
 * Manage sales channels used for customer categorization and pricing.
 * Uses the universal EntityList component with the salesChannelEntity config.
 */

import { EntityList } from "@/components/universal/entity-list";
import { salesChannelEntity } from "@/entities/sales-channel";

export default function SalesChannelsPage() {
  return (
    <EntityList
      entity={salesChannelEntity}
      basePath="/settings/sales-channels"
    />
  );
}
