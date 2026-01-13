"use client";

import { EntityList } from "@/components/universal/entity-list";
import { salesChannelEntity } from "@/entities/sales-channel";

export default function SalesChannelsPage() {
  return <EntityList entity={salesChannelEntity} basePath="/settings/sales-channels" />;
}
