"use client";

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { salesChannelEntity } from "@/entities/sales-channel";

export default function NewSalesChannelPage() {
  return (
    <EntityDetailPage
      entity={salesChannelEntity}
      basePath="/settings/sales-channels"
    />
  );
}
