"use client";

import { EntityDetail } from "@/components/universal/entity-detail";
import { salesChannelEntity } from "@/entities/sales-channel";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SalesChannelDetailPage({ params }: Props) {
  const { id } = await params;
  return <EntityDetail entity={salesChannelEntity} id={id} basePath="/settings/sales-channels" />;
}
