"use client";

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { salesChannelEntity } from "@/entities/sales-channel";

export default function SalesChannelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailPage entity={salesChannelEntity} id={id} basePath="/settings/sales-channels" />;
}
