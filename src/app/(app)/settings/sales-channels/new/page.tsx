"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { salesChannelEntity } from "@/entities/sales-channel";

export default function NewSalesChannelPage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={salesChannelEntity}
      basePath="/settings/sales-channels"
    />
  );
}
