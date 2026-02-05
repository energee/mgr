"use client";

import { use } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { salesChannelEntity } from "@/entities/sales-channel";

export default function SalesChannelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailUnifiedWithErrorBoundary entity={salesChannelEntity} id={id} basePath="/settings/sales-channels" />;
}
