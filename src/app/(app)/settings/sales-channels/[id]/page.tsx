"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { salesChannelEntity } from "@/entities/sales-channel";

export default function SalesChannelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetail entity={salesChannelEntity} id={id} basePath="/settings/sales-channels" />;
}
